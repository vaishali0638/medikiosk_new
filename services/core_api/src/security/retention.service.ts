import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { AuditRepository } from '../audit/audit.repository';

export interface PurgeReport {
  readonly dataKind: string;
  readonly eligible: number;
  readonly heldBack: number;
  readonly deleted: number;
}

/**
 * Deletes data the hospital's own policy says is no longer needed — unless a legal hold
 * says otherwise.
 *
 * Two rules, and the second always beats the first:
 *
 *   1. Data older than the hospital's approved retention period for its kind is eligible.
 *      No policy means nothing is eligible: an absent policy is not permission to delete,
 *      it is an unanswered question.
 *   2. A live legal hold on the patient or the encounter stops deletion outright. Keeping
 *      data slightly too long is a privacy fault; destroying it under a hold is spoliation
 *      of evidence, and the two are not comparable.
 *
 * Nothing here touches `audit_event`. The audit trail records who did what to a patient's
 * record, is append-only by database rule, and outlives the clinical data it describes —
 * a deletion nobody can prove happened is not a deletion anybody can defend.
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  /** What would be deleted, without deleting it. Run before the real thing, always. */
  async plan(hospitalId: string): Promise<PurgeReport[]> {
    return this.run(hospitalId, { dryRun: true, correlationId: 'plan', actorId: 'system' });
  }

  async purge(input: {
    hospitalId: string;
    correlationId: string;
    actorId: string;
  }): Promise<PurgeReport[]> {
    return this.run(input.hospitalId, { ...input, dryRun: false });
  }

  private async run(
    hospitalId: string,
    options: { dryRun: boolean; correlationId: string; actorId: string },
  ): Promise<PurgeReport[]> {
    const policies = await this.db
      .selectFrom('retention_policy')
      .selectAll()
      .where('hospital_id', '=', hospitalId)
      .execute();

    const held = await this.heldPatientIds(hospitalId);
    const reports: PurgeReport[] = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retain_days * 86_400_000);

      if (policy.data_kind === 'IDENTITY_ATTEMPT') {
        // Failed lookups name a mobile number and a kiosk. They are the record of who
        // tried to check in and when, and nobody needs them a year later.
        const rows = await this.db
          .selectFrom('identity_attempt')
          .select(['id', 'matched_patient_id'])
          .where('hospital_id', '=', hospitalId)
          .where('created_at', '<', cutoff)
          .execute();

        const deletable = rows.filter(
          (r) => r.matched_patient_id === null || !held.has(r.matched_patient_id),
        );

        if (!options.dryRun && deletable.length > 0) {
          await this.db
            .deleteFrom('identity_attempt')
            .where(
              'id',
              'in',
              deletable.map((r) => r.id),
            )
            .execute();
        }

        reports.push({
          dataKind: policy.data_kind,
          eligible: rows.length,
          heldBack: rows.length - deletable.length,
          deleted: options.dryRun ? 0 : deletable.length,
        });
        continue;
      }

      if (policy.data_kind === 'KIOSK_SESSION') {
        const rows = await this.db
          .selectFrom('kiosk_session')
          .innerJoin('kiosk_device', 'kiosk_device.id', 'kiosk_session.kiosk_device_id')
          .innerJoin('branch', 'branch.id', 'kiosk_device.branch_id')
          .select(['kiosk_session.id as id', 'kiosk_session.patient_id as patientId'])
          .where('branch.hospital_id', '=', hospitalId)
          .where('kiosk_session.ended_at', '<', cutoff)
          .execute();

        const deletable = rows.filter((r) => r.patientId === null || !held.has(r.patientId));

        if (!options.dryRun && deletable.length > 0) {
          await this.db
            .deleteFrom('kiosk_session')
            .where(
              'id',
              'in',
              deletable.map((r) => r.id),
            )
            .execute();
        }

        reports.push({
          dataKind: policy.data_kind,
          eligible: rows.length,
          heldBack: rows.length - deletable.length,
          deleted: options.dryRun ? 0 : deletable.length,
        });
        continue;
      }

      // A kind with a policy but no implemented sweep is reported as zero rather than
      // silently skipped, so a hospital can see that its policy is not being applied.
      reports.push({ dataKind: policy.data_kind, eligible: 0, heldBack: 0, deleted: 0 });
    }

    if (!options.dryRun) {
      await this.audit.append({
        actorId: options.actorId,
        actorRole: 'system',
        action: 'RETENTION_PURGE_RUN',
        entityType: 'hospital',
        entityId: hospitalId,
        correlationId: options.correlationId,
        detail: { reports },
      });
    }

    return reports;
  }

  /** Patients with a live hold. A hold on an encounter holds its patient too. */
  private async heldPatientIds(hospitalId: string): Promise<Set<string>> {
    const holds = await this.db
      .selectFrom('legal_hold')
      .leftJoin('encounter', 'encounter.id', 'legal_hold.encounter_id')
      .select(['legal_hold.patient_id as directPatientId', 'encounter.patient_id as viaEncounter'])
      .where('legal_hold.hospital_id', '=', hospitalId)
      .where('legal_hold.released_at', 'is', null)
      .execute();

    const held = new Set<string>();
    for (const hold of holds) {
      if (hold.directPatientId) held.add(hold.directPatientId);
      if (hold.viaEncounter) held.add(hold.viaEncounter);
    }
    return held;
  }
}
