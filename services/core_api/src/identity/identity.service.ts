import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IdentityMatchStrength,
  IdentityMethod,
  IdentityOutcome,
  ResolveIdentityRequest,
} from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { PatientRow } from '../db/database.types';
import type { Env } from '../config/env';
import { DomainError } from '../common/domain-error';
import { maskName, maskTail } from '../common/redact';
import { AuditRepository } from '../audit/audit.repository';
import { OtpService } from './otp.service';

/**
 * How long a resolved-but-unconfirmed candidate stays valid.
 *
 * Short: it exists only for the seconds between the kiosk showing masked details and the
 * patient pressing "Yes, this is me". A long-lived handle would be a way to hold someone
 * else's resolved identity open.
 */
const CANDIDATE_TTL_SECONDS = 180;

/** Strength each method can achieve. Nothing may claim more than its evidence supports. */
const METHOD_STRENGTH: Readonly<Record<IdentityMethod, IdentityMatchStrength>> = {
  UHID_AND_ENCOUNTER: 'STRONGEST',
  APPOINTMENT_QR: 'STRONG',
  ABHA_VERIFIED: 'STRONG',
  // Possession of a handset, not proof of identity. Family phones are shared.
  MOBILE_OTP: 'MODERATE',
};

/** Only a STRONG or better match may release a patient record. */
const MINIMUM_RELEASE_STRENGTH: readonly IdentityMatchStrength[] = ['STRONG', 'STRONGEST'];

export interface ResolveContext {
  readonly hospitalId: string;
  readonly kioskDeviceId: string;
  readonly kioskSessionId?: string | undefined;
  readonly correlationId: string;
  readonly actorId: string;
}

export interface ResolvedCandidate {
  readonly candidateId: string;
  readonly method: IdentityMethod;
  readonly strength: IdentityMatchStrength;
  readonly maskedName: string;
  readonly maskedMobile: string;
  readonly maskedUhid?: string | undefined;
  readonly expiresAt: Date;
}

interface PendingCandidate {
  readonly patientId: string;
  /** The identity_attempt row this candidate came from, so confirmation lands on it. */
  readonly attemptId: string;
  readonly method: IdentityMethod;
  readonly strength: IdentityMatchStrength;
  readonly sessionId?: string | undefined;
  readonly expiresAt: number;
}

@Injectable()
export class IdentityService {
  /**
   * Resolved-but-unconfirmed candidates, held in memory only.
   *
   * Deliberately not persisted: an unconfirmed identity is not a fact about anyone, and
   * writing it would create a durable record associating a kiosk with a patient who may
   * turn out not to be the person standing there. They expire in three minutes and die
   * with the process.
   */
  private readonly candidates = new Map<string, PendingCandidate>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
    private readonly audit: AuditRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Resolves a patient, or refuses.
   *
   * The shape of this method is the safety property: every path that is not exactly one
   * confident match ends in a refusal that discloses nothing. There is no branch that
   * picks the best of several candidates, and no branch that falls back to a weaker
   * method, because "probably this person" is the wrong-patient failure mode itself.
   */
  async resolve(
    request: ResolveIdentityRequest,
    context: ResolveContext,
  ): Promise<ResolvedCandidate> {
    const method = request.method;
    const strength = METHOD_STRENGTH[method];

    if (method === 'ABHA_VERIFIED' && !this.config.get('FEATURE_ABHA', { infer: true })) {
      await this.record(context, method, strength, 0, null, 'METHOD_DISABLED');
      throw new DomainError('IDENTITY_NOT_CONFIRMED', context.correlationId, 'ABHA disabled');
    }

    const candidates = await this.findCandidates(request, context);

    if (candidates.length === 0) {
      await this.record(context, method, strength, 0, null, 'NOT_FOUND');
      throw new DomainError('IDENTITY_NOT_CONFIRMED', context.correlationId, 'no match');
    }

    if (candidates.length > 1) {
      // A shared family phone, or a genuine duplicate in the hospital's records. Either
      // way the system does not choose, and it does not merge. Staff resolve it.
      await this.record(context, method, strength, candidates.length, null, 'AMBIGUOUS');
      throw new DomainError(
        'IDENTITY_AMBIGUOUS',
        context.correlationId,
        `${candidates.length} candidates`,
      );
    }

    if (!MINIMUM_RELEASE_STRENGTH.includes(strength)) {
      // MODERATE means a mobile OTP. It proves possession of a handset and nothing more,
      // and a date of birth does not raise it: a birth date appears on every form the
      // patient has ever filled in and is known to their whole family, so it disambiguates
      // a shared phone without being evidence of identity. An existing patient who can
      // only offer a phone number is sent to the counter, which is a working route to care
      // rather than a dead end — the alternative is handing a medical record to whoever is
      // holding the handset.
      await this.record(context, method, strength, 1, null, 'INSUFFICIENT_STRENGTH');
      throw new DomainError(
        'IDENTITY_NOT_CONFIRMED',
        context.correlationId,
        `strength ${strength} below release threshold`,
      );
    }

    const patient = candidates[0] as PatientRow;
    const candidateId = randomUUID();
    const expiresAt = new Date(Date.now() + CANDIDATE_TTL_SECONDS * 1000);

    const attemptId = await this.record(context, method, strength, 1, patient.id, 'MATCHED');

    this.candidates.set(candidateId, {
      patientId: patient.id,
      attemptId,
      method,
      strength,
      sessionId: context.kioskSessionId,
      expiresAt: expiresAt.getTime(),
    });
    this.sweepExpiredCandidates();

    const uhidRow = await this.db
      .selectFrom('patient_identifier')
      .select('value')
      .where('patient_id', '=', patient.id)
      .where('type', '=', 'UHID')
      .executeTakeFirst();

    return {
      candidateId,
      method,
      strength,
      // Masked, always. The kiosk stands in a public corridor and a bystander must not be
      // able to harvest a name and number by watching the screen.
      maskedName: patient.full_name ? maskName(patient.full_name) : '',
      maskedMobile: patient.mobile ? maskTail(patient.mobile) : '',
      maskedUhid: uhidRow ? maskTail(uhidRow.value) : undefined,
      expiresAt,
    };
  }

  /**
   * The patient confirms the masked details are theirs.
   *
   * Confirmation is a separate step from resolution on purpose: the system proposes and
   * the person in front of the kiosk decides. Without it, a UHID typed one digit wrong
   * would silently open a stranger's record.
   */
  async confirm(candidateId: string, context: ResolveContext): Promise<PendingCandidate> {
    const candidate = this.candidates.get(candidateId);

    if (!candidate || candidate.expiresAt <= Date.now()) {
      this.candidates.delete(candidateId);
      throw new DomainError(
        'IDENTITY_NOT_CONFIRMED',
        context.correlationId,
        'candidate unknown or expired',
      );
    }

    // Single-use: a confirmation handle must not be replayable.
    this.candidates.delete(candidateId);

    // Updated by attempt id, not correlation id: resolve and confirm are two separate
    // HTTP requests and each carries its own correlation id unless a client threads one
    // through. Matching on correlation id silently updated nothing, leaving every
    // confirmed match recorded as unconfirmed.
    await this.db
      .updateTable('identity_attempt')
      .set({ confirmed: true })
      .where('id', '=', candidate.attemptId)
      .execute();

    await this.audit.append({
      actorId: context.actorId,
      actorRole: 'KIOSK',
      action: 'IDENTITY_CONFIRMED',
      entityType: 'patient',
      entityId: candidate.patientId,
      correlationId: context.correlationId,
      detail: { method: candidate.method, strength: candidate.strength },
    });

    return candidate;
  }

  /**
   * Finds every patient a request could refer to.
   *
   * Returns all matches rather than the "best" one, so the caller has to confront
   * ambiguity instead of a narrowing step quietly hiding it.
   */
  private async findCandidates(
    request: ResolveIdentityRequest,
    context: ResolveContext,
  ): Promise<PatientRow[]> {
    switch (request.method) {
      case 'UHID_AND_ENCOUNTER': {
        const rows = await this.db
          .selectFrom('patient')
          .innerJoin('patient_identifier', 'patient_identifier.patient_id', 'patient.id')
          .selectAll('patient')
          .where('patient.hospital_id', '=', context.hospitalId)
          .where('patient.provisional', '=', false)
          .where('patient_identifier.type', '=', 'UHID')
          .where('patient_identifier.value', '=', request.uhid)
          .where('patient_identifier.issued_by', '=', context.hospitalId)
          .execute();

        // A UHID is printed on paper and can be picked up or mistyped, so it is treated
        // as a lookup key rather than proof. The birth date the patient supplies is the
        // part only they should know.
        return this.narrowByBirth(rows, request.dateOfBirth, request.yearOfBirth);
      }

      case 'MOBILE_OTP': {
        const verification = await this.otp.consume(request.verificationId, context.correlationId);

        const rows = await this.db
          .selectFrom('patient')
          .selectAll()
          .where('hospital_id', '=', context.hospitalId)
          .where('provisional', '=', false)
          .where('mobile', '=', verification.mobile)
          .execute();

        return this.narrowByBirth(rows, request.dateOfBirth, request.yearOfBirth);
      }

      case 'APPOINTMENT_QR':
      case 'ABHA_VERIFIED':
        // Both need an external adapter the hospital must supply: an appointment QR is
        // signed by the HIS, and ABHA requires ABDM onboarding. Returning nothing is the
        // honest behaviour — a stub that resolved a patient would be inventing identity.
        return [];

      default:
        return [];
    }
  }

  /**
   * Narrows a candidate set by date or year of birth.
   *
   * Only ever narrows. If the patient supplies nothing, the full set is returned and the
   * caller refuses it as ambiguous — a missing answer must not be treated as a match.
   */
  private narrowByBirth(
    rows: PatientRow[],
    dateOfBirth?: string,
    yearOfBirth?: number,
  ): PatientRow[] {
    if (rows.length <= 1) return rows;
    if (!dateOfBirth && yearOfBirth === undefined) return rows;

    return rows.filter((row) => {
      if (!row.date_of_birth) return false;
      const stored = new Date(row.date_of_birth);
      if (dateOfBirth) return stored.toISOString().slice(0, 10) === dateOfBirth;
      return stored.getUTCFullYear() === yearOfBirth;
    });
  }

  /** Records every attempt, successful or not. A failed lookup is as interesting as a hit. */
  private async record(
    context: ResolveContext,
    method: IdentityMethod,
    strength: IdentityMatchStrength,
    candidateCount: number,
    matchedPatientId: string | null,
    outcome: IdentityOutcome,
  ): Promise<string> {
    const row = await this.db
      .insertInto('identity_attempt')
      .values({
        hospital_id: context.hospitalId,
        kiosk_device_id: context.kioskDeviceId,
        kiosk_session_id: context.kioskSessionId ?? null,
        method,
        strength,
        candidate_count: candidateCount,
        matched_patient_id: matchedPatientId,
        outcome,
        correlation_id: context.correlationId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  }

  private sweepExpiredCandidates(): void {
    const now = Date.now();
    for (const [id, candidate] of this.candidates) {
      if (candidate.expiresAt <= now) this.candidates.delete(id);
    }
  }

  /** Test seam: how many candidates are currently held. */
  get pendingCandidateCount(): number {
    this.sweepExpiredCandidates();
    return this.candidates.size;
  }
}
