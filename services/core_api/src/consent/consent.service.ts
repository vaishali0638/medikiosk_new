import { Inject, Injectable } from '@nestjs/common';
import type { ConsentCaptureMethod, ConsentDataCategory } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { ConsentRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { ConsentRepository } from './consent.repository';
import { ConsentNoticeService } from './consent-notice.service';
import { permitsClinicalIntake } from '../state-machines';

/** How long a consent authorises processing. One OPD visit, not an open-ended licence. */
const CONSENT_VALIDITY_HOURS = 24;

export interface CaptureDecisionInput {
  readonly hospitalId: string;
  readonly language: string;
  readonly decision: 'GRANTED' | 'DECLINED';
  readonly captureMethod: ConsentCaptureMethod;
  readonly kioskDeviceId?: string | undefined;
  readonly correlationId: string;
  readonly actorId: string;
  /** Existing patient, when identity is already known. Otherwise a provisional one is made. */
  readonly patientId?: string | undefined;
}

@Injectable()
export class ConsentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly consents: ConsentRepository,
    private readonly notices: ConsentNoticeService,
  ) {}

  /**
   * Records a consent decision against the notice the patient was actually shown.
   *
   * The notice is re-read here rather than trusted from the client. A kiosk running a
   * stale build could otherwise report agreement to a superseded version, and the
   * artefact would then misstate what the patient saw.
   */
  async capture(input: CaptureDecisionInput): Promise<ConsentRow> {
    const notice = await this.notices.findPublished(input.hospitalId, input.language);
    if (!notice) {
      // No approved wording in this language means there is nothing lawful to agree to.
      throw new DomainError(
        'CONSENT_REQUIRED',
        input.correlationId,
        `no published consent notice for language ${input.language}`,
      );
    }

    const patientId = input.patientId ?? (await this.createProvisionalPatient(input.hospitalId));

    return this.consents.capture({
      patientId,
      hospitalId: input.hospitalId,
      purpose: notice.purpose,
      dataCategories: notice.dataCategories as readonly ConsentDataCategory[],
      languageTag: input.language,
      noticeVersion: notice.version,
      captureMethod: input.captureMethod,
      kioskDeviceId: input.kioskDeviceId,
      validUntil: new Date(Date.now() + CONSENT_VALIDITY_HOURS * 3_600_000),
      decision: input.decision,
      correlationId: input.correlationId,
      actorId: input.actorId,
    });
  }

  /**
   * Creates the placeholder a consent artefact hangs on before identity is known.
   *
   * The specified order is language -> consent -> identity, so at this point nothing is
   * known about the patient. The row carries no demographics at all, which
   * `patient_confirmed_has_demographics` permits only while `provisional` is true —
   * so a provisional patient cannot be mistaken for, or promoted to, a real record
   * without the identity step supplying them.
   */
  private async createProvisionalPatient(hospitalId: string): Promise<string> {
    const row = await this.db
      .insertInto('patient')
      .values({ hospital_id: hospitalId, provisional: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * The gate every later phase calls before touching clinical data.
   *
   * Throws rather than returning a boolean: a caller that forgets to check the result of
   * a permission function is a silent authorisation bypass, and this is the one place
   * where that mistake would mean processing health data without a legal basis.
   */
  async requireActiveConsent(patientId: string, correlationId: string): Promise<ConsentRow> {
    const consent = await this.consents.findActive(patientId);

    if (!consent) {
      // Distinguish "declined" from "never asked" for the audit log, but both refuse.
      const latest = await this.db
        .selectFrom('consent')
        .selectAll()
        .where('patient_id', '=', patientId)
        .orderBy('captured_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (latest?.state === 'DECLINED') {
        throw new DomainError('CONSENT_DECLINED', correlationId, `patient ${patientId} declined`);
      }
      if (latest?.state === 'EXPIRED' || latest?.state === 'REVOKED') {
        throw new DomainError(
          'CONSENT_EXPIRED',
          correlationId,
          `consent ${latest.id} is ${latest.state}`,
        );
      }
      // Still marked GRANTED but past its validity window: the expiry sweep runs on a
      // schedule, so a lapsed consent is routinely refused before it has been restated.
      // Reporting CONSENT_REQUIRED here would tell an operator the patient was never
      // asked, when in fact they consented and it ran out.
      if (latest?.state === 'GRANTED' && new Date(latest.valid_until).getTime() <= Date.now()) {
        throw new DomainError(
          'CONSENT_EXPIRED',
          correlationId,
          `consent ${latest.id} lapsed at ${new Date(latest.valid_until).toISOString()}`,
        );
      }
      throw new DomainError('CONSENT_REQUIRED', correlationId, `no consent for ${patientId}`);
    }

    // Belt and braces: findActive already filters on state and validity, but this is the
    // authorisation boundary and it re-asserts rather than assuming.
    if (!permitsClinicalIntake(consent.state)) {
      throw new DomainError('CONSENT_REQUIRED', correlationId, `consent is ${consent.state}`);
    }

    return consent;
  }
}
