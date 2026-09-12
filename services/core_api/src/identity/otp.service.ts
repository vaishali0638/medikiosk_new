import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { OtpPurpose } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { OtpVerificationRow } from '../db/database.types';
import type { Env } from '../config/env';
import { DomainError } from '../common/domain-error';
import { maskTail } from '../common/redact';
import { withSerializableRetry } from '../db/transaction';
import { SmsAdapter } from '../sms/sms.adapter';
import { AuditRepository } from '../audit/audit.repository';

/** Short enough to limit a brute-force window, long enough for a patient to read and type. */
const OTP_TTL_SECONDS = 300;
const MAX_VERIFY_ATTEMPTS = 5;

/** Send-rate limit: codes to one number within the window. */
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_SECONDS = 900;

export interface IssueOtpInput {
  readonly hospitalId: string;
  readonly kioskDeviceId?: string | undefined;
  readonly mobile: string;
  readonly purpose: OtpPurpose;
  readonly correlationId: string;
  readonly actorId: string;
}

export interface IssuedOtp {
  readonly verificationId: string;
  readonly maskedMobile: string;
  readonly expiresAt: Date;
  readonly attemptsAllowed: number;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sms: SmsAdapter,
    private readonly audit: AuditRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Issues a one-time code.
   *
   * The response is identical whether or not the number belongs to a registered patient.
   * Anything else would let someone stand at a kiosk and test which mobile numbers are
   * patients of this hospital.
   */
  async issue(input: IssueOtpInput): Promise<IssuedOtp> {
    await this.assertSendRateOk(input);

    // randomInt is CSPRNG-backed. Math.random would make codes predictable from one
    // observed code, which is the whole security of the mechanism.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const keyId = this.keyId();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    const row = await withSerializableRetry(this.db, async (trx) => {
      // Re-sending supersedes: a patient must not end up holding several live codes.
      await trx
        .updateTable('otp_verification')
        .set({ state: 'EXPIRED' })
        .where('hospital_id', '=', input.hospitalId)
        .where('mobile', '=', input.mobile)
        .where('purpose', '=', input.purpose)
        .where('state', '=', 'PENDING')
        .execute();

      return trx
        .insertInto('otp_verification')
        .values({
          hospital_id: input.hospitalId,
          kiosk_device_id: input.kioskDeviceId ?? null,
          purpose: input.purpose,
          mobile: input.mobile,
          code_hash: this.hash(code, keyId),
          code_key_id: keyId,
          max_attempts: MAX_VERIFY_ATTEMPTS,
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    await this.sms.send({
      mobile: input.mobile,
      body: `${code} is your MediKiosk verification code. It expires in 5 minutes. Do not share it.`,
      correlationId: input.correlationId,
    });

    // The audit records that a code was sent, never the code and never the full number.
    await this.audit.append({
      actorId: input.actorId,
      actorRole: 'KIOSK',
      action: 'OTP_SENT',
      entityType: 'otp_verification',
      entityId: row.id,
      correlationId: input.correlationId,
      detail: { purpose: input.purpose, mobile: input.mobile },
    });

    return {
      verificationId: row.id,
      maskedMobile: maskTail(input.mobile),
      expiresAt,
      attemptsAllowed: MAX_VERIFY_ATTEMPTS,
    };
  }

  /**
   * Verifies a submitted code.
   *
   * Each failure burns an attempt; exhausting the allowance LOCKS the verification, which
   * is terminal. A patient then requests a new code rather than getting more guesses at
   * this one — without that, six digits is a few thousand guesses from a determined caller.
   */
  async verify(
    verificationId: string,
    code: string,
    correlationId: string,
    actorId: string,
  ): Promise<OtpVerificationRow> {
    // The transaction RETURNS a verdict rather than throwing one.
    //
    // Throwing from inside it would roll back the attempt counter along with the failure,
    // so every wrong guess would look like the first — the lock would never engage and a
    // six-digit code would be a few thousand guesses from a determined caller. The
    // counter must commit precisely when the attempt fails, so the refusal is raised
    // after the transaction closes.
    const verdict = await withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('otp_verification')
        .selectAll()
        .where('id', '=', verificationId)
        .forUpdate()
        .executeTakeFirst();

      if (!row) return { kind: 'unknown' } as const;
      if (row.state !== 'PENDING') return { kind: 'not-pending', state: row.state } as const;

      // Expiry against the database clock, so a device with a wrong time cannot extend it.
      const clock = await trx
        .selectNoFrom((eb) => eb(sql<Date>`now()`, '>=', row.expires_at).as('expired'))
        .executeTakeFirstOrThrow();

      if (clock.expired) {
        await trx
          .updateTable('otp_verification')
          .set({ state: 'EXPIRED' })
          .where('id', '=', verificationId)
          .execute();
        return { kind: 'expired' } as const;
      }

      const attempts = row.attempt_count + 1;

      if (!this.matches(code, row.code_hash, row.code_key_id)) {
        const locked = attempts >= row.max_attempts;
        await trx
          .updateTable('otp_verification')
          .set({ attempt_count: attempts, ...(locked ? { state: 'LOCKED' as const } : {}) })
          .where('id', '=', verificationId)
          .execute();
        return { kind: 'mismatch', locked } as const;
      }

      const verified = await trx
        .updateTable('otp_verification')
        .set({ state: 'VERIFIED', verified_at: new Date(), attempt_count: attempts })
        .where('id', '=', verificationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { kind: 'verified', row: verified } as const;
    });

    switch (verdict.kind) {
      case 'unknown':
        throw new DomainError('VALIDATION_FAILED', correlationId, 'unknown verification');
      case 'not-pending':
        throw new DomainError(
          'VALIDATION_FAILED',
          correlationId,
          `verification ${verificationId} is ${verdict.state}`,
        );
      case 'expired':
        throw new DomainError('VALIDATION_FAILED', correlationId, 'verification expired');
      case 'mismatch':
        throw new DomainError(
          verdict.locked ? 'RATE_LIMITED' : 'VALIDATION_FAILED',
          correlationId,
          verdict.locked ? 'verification locked after too many attempts' : 'code did not match',
        );
      case 'verified':
        break;
    }

    await this.audit.append({
      actorId,
      actorRole: 'KIOSK',
      action: 'OTP_VERIFIED',
      entityType: 'otp_verification',
      entityId: verificationId,
      correlationId,
    });

    return verdict.row;
  }

  /**
   * Spends a verified code on an identity resolution.
   *
   * Single-use: without this, one verification could confirm several different identities
   * in the same session.
   */
  async consume(verificationId: string, correlationId: string): Promise<OtpVerificationRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('otp_verification')
        .selectAll()
        .where('id', '=', verificationId)
        .forUpdate()
        .executeTakeFirst();

      if (!row) throw new DomainError('VALIDATION_FAILED', correlationId, 'unknown verification');
      if (row.state === 'CONSUMED') {
        throw new DomainError('VALIDATION_FAILED', correlationId, 'verification already used');
      }
      if (row.state !== 'VERIFIED') {
        throw new DomainError('VALIDATION_FAILED', correlationId, `verification is ${row.state}`);
      }

      return trx
        .updateTable('otp_verification')
        .set({ state: 'CONSUMED', consumed_at: new Date() })
        .where('id', '=', verificationId)
        .where('version', '=', row.version)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /** Marks lapsed codes expired. Housekeeping; verify() checks expiry itself. */
  async expireLapsed(): Promise<number> {
    const result = await this.db
      .updateTable('otp_verification')
      .set({ state: 'EXPIRED' })
      .where('state', '=', 'PENDING')
      .where('expires_at', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  private async assertSendRateOk(input: IssueOtpInput): Promise<void> {
    const recent = await this.db
      .selectFrom('otp_verification')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('hospital_id', '=', input.hospitalId)
      .where('mobile', '=', input.mobile)
      .where('sent_at', '>', sql<Date>`now() - make_interval(secs => ${SEND_WINDOW_SECONDS})`)
      .executeTakeFirstOrThrow();

    if (Number(recent.count) >= MAX_SENDS_PER_WINDOW) {
      // Rate limiting protects the patient (SMS bombing) as much as the system.
      throw new DomainError(
        'RATE_LIMITED',
        input.correlationId,
        `send limit reached for ${maskTail(input.mobile)}`,
      );
    }
  }

  private keyId(): string {
    return this.config.get('OTP_KEY_ID', { infer: true }) ?? 'dev';
  }

  private secret(keyId: string): string {
    const configured = this.config.get('OTP_HMAC_SECRET', { infer: true });
    if (configured) return `${keyId}:${configured}`;
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error('OTP_HMAC_SECRET is required in production');
    }
    return `${keyId}:development-only-secret`;
  }

  private hash(code: string, keyId: string): string {
    return createHmac('sha256', this.secret(keyId)).update(code).digest('hex');
  }

  /** Constant-time comparison, so response timing cannot leak the code digit by digit. */
  private matches(code: string, expectedHash: string, keyId: string): boolean {
    const actual = Buffer.from(this.hash(code, keyId), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
