import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { OtpPurpose, OtpState } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { OtpVerificationRow } from '../db/database.types';
import type { Env } from '../config/env';
import { DomainError } from '../common/domain-error';
import { maskTail } from '../common/redact';
import { withSerializableRetry } from '../db/transaction';
import { SmsAdapter } from '../sms/sms.adapter';
import { AuditRepository } from '../audit/audit.repository';
import { SupabaseOtpTransport } from './supabase-otp.transport';

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

/**
 * What happened, decided before anything is thrown.
 *
 * The transaction that records a failed attempt must COMMIT — throwing from inside it
 * would roll the counter back with the failure, so every wrong guess would look like the
 * first and the lockout would never engage. So the outcome is returned, not raised.
 */
type OtpVerdict =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-pending'; readonly state: OtpState }
  | { readonly kind: 'expired' }
  | { readonly kind: 'mismatch'; readonly locked: boolean }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'verified'; readonly row: OtpVerificationRow };

export interface IssuedOtp {
  readonly verificationId: string;
  readonly maskedMobile: string;
  readonly expiresAt: Date;
  readonly attemptsAllowed: number;
  readonly devCode?: string;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sms: SmsAdapter,
    private readonly audit: AuditRepository,
    private readonly config: ConfigService<Env, true>,
    // Absent unless OTP_PROVIDER=supabase. Constructing it eagerly would demand Supabase
    // credentials from every deployment that does not use it.
    @Optional() private readonly supabase: SupabaseOtpTransport | null = null,
  ) {}

  private get usesSupabase(): boolean {
    return (
      this.config.get('OTP_PROVIDER', { infer: true }) === 'supabase' && this.supabase !== null
    );
  }

  /**
   * Issues a one-time code.
   *
   * The response is identical whether or not the number belongs to a registered patient.
   * Anything else would let someone stand at a kiosk and test which mobile numbers are
   * patients of this hospital.
   */
  async issue(input: IssueOtpInput): Promise<IssuedOtp> {
    await this.assertSendRateOk(input);

    const supabase = this.usesSupabase ? this.supabase : null;

    // With Supabase there is no local code: it generates one, sends it, and checks it.
    // randomInt is CSPRNG-backed. Math.random would make codes predictable from one
    // observed code, which is the whole security of the mechanism.
    const code = supabase ? null : String(randomInt(0, 1_000_000)).padStart(6, '0');
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
          // Empty for a Supabase row, and the CHECK constraint requires it to be: an
          // HMAC of nothing would look like a code this service could verify.
          code_hash: code === null ? '' : this.hash(code, keyId),
          code_key_id: keyId,
          verifier: supabase ? 'SUPABASE' : 'LOCAL',
          max_attempts: MAX_VERIFY_ATTEMPTS,
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    if (supabase) {
      // A row whose code was never sent must not sit PENDING: the patient would be asked
      // for a code that does not exist, and it would still count against their send limit.
      const sent = await supabase.send(input.mobile, input.correlationId);
      if (!sent) {
        await this.db
          .updateTable('otp_verification')
          .set({ state: 'EXPIRED' })
          .where('id', '=', row.id)
          .execute();
        throw new DomainError(
          'OTP_SERVICE_UNAVAILABLE',
          input.correlationId,
          'the verification service did not accept the request',
        );
      }
    } else {
      await this.sms.send({
        mobile: input.mobile,
        body:
          `${code as string} is your MediKiosk verification code. ` +
          'It expires in 5 minutes. Do not share it.',
        correlationId: input.correlationId,
      });
    }

    // The audit records that a code was sent, never the code and never the full number.
    await this.audit.append({
      actorId: input.actorId,
      actorRole: 'KIOSK',
      action: 'OTP_SENT',
      entityType: 'otp_verification',
      entityId: row.id,
      correlationId: input.correlationId,
      detail: {
        purpose: input.purpose,
        mobile: input.mobile,
        verifier: supabase ? 'SUPABASE' : 'LOCAL',
      },
    });

    return {
      verificationId: row.id,
      maskedMobile: maskTail(input.mobile),
      expiresAt,
      attemptsAllowed: MAX_VERIFY_ATTEMPTS,
      ...(this.config.get('NODE_ENV', { infer: true }) !== 'production' &&
      this.sms.kind === 'sandbox' &&
      code
        ? { devCode: code }
        : {}),
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
    // Branch on the ROW, not on configuration. Flipping OTP_PROVIDER must not strand the
    // codes that are already in patients' hands: a row issued locally is still checked
    // locally, and one issued through Supabase is still checked there.
    const issued = await this.db
      .selectFrom('otp_verification')
      .select(['verifier', 'mobile'])
      .where('id', '=', verificationId)
      .executeTakeFirst();

    const verdict: OtpVerdict = !issued
      ? { kind: 'unknown' }
      : issued.verifier === 'SUPABASE'
        ? await this.verifyWithSupabase(verificationId, issued.mobile, code, correlationId)
        : await this.verifyLocally(verificationId, code);

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
      case 'unavailable':
        // Not RATE_LIMITED and not VALIDATION_FAILED: the patient did nothing wrong and
        // no attempt was spent. Mislabelling this would send them away believing they
        // mistyped a code they typed correctly.
        throw new DomainError(
          'OTP_SERVICE_UNAVAILABLE',
          correlationId,
          'the verification service could not be reached',
        );
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

  /**
   * The local check: the code is compared against the HMAC this service stored.
   *
   * Everything happens in one serializable transaction because nothing here leaves the
   * database — contrast verifyWithSupabase, which cannot.
   */
  private async verifyLocally(verificationId: string, code: string): Promise<OtpVerdict> {
    return withSerializableRetry(this.db, async (trx) => {
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
  }

  /**
   * The Supabase check.
   *
   * Split across two transactions with a network call between them, which is deliberate.
   * Holding a row lock open across a call to another provider would block every retry on
   * their latency, and — worse — a serialization retry would replay the check against
   * Supabase, where the code is single-use. The replay would be refused, failing a code
   * that had just succeeded.
   */
  private async verifyWithSupabase(
    verificationId: string,
    mobile: string,
    code: string,
    correlationId: string,
  ): Promise<OtpVerdict> {
    // The row says SUPABASE but no transport is configured — the deployment was changed
    // under a live code. Unavailable is the truthful answer: we cannot check it, and
    // calling it wrong would cost the patient an attempt for our misconfiguration.
    const supabase = this.supabase;
    if (!supabase) return { kind: 'unavailable' };

    // Cheap refusals first, so an already-locked or expired verification never reaches
    // Supabase and never spends the patient's code.
    const gate = await withSerializableRetry(this.db, async (trx) => {
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
      return { kind: 'ok' } as const;
    });

    if (gate.kind !== 'ok') return gate;

    const outcome = await supabase.verify(mobile, code, correlationId);
    // An outage is not a wrong code. Returning before the counter is touched is the whole
    // reason the transport reports three outcomes rather than a boolean.
    if (outcome === 'unavailable') return { kind: 'unavailable' };

    return withSerializableRetry(this.db, async (trx) => {
      // Re-read under lock: the gate released its lock while Supabase was called, so a
      // concurrent attempt may have locked or consumed this verification since.
      const row = await trx
        .selectFrom('otp_verification')
        .selectAll()
        .where('id', '=', verificationId)
        .forUpdate()
        .executeTakeFirst();

      if (!row) return { kind: 'unknown' } as const;
      if (row.state !== 'PENDING') return { kind: 'not-pending', state: row.state } as const;

      const attempts = row.attempt_count + 1;

      if (outcome === 'rejected') {
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
