import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import type { StaffContext } from './staff-auth.service';

export interface AccessibleEncounter {
  readonly encounterId: string;
  readonly patientId: string;
  readonly departmentId: string;
  readonly preCheckinId: string | null;
  readonly verifiedAt: Date | null;
}

/**
 * Decides whether a clinician may open a particular record.
 *
 * Three checks, in the order they matter:
 *
 *   1. **Role.** Only a CLINICIAN reads clinical records. Governance reviewers approve
 *      content and operations staff unstick queues; neither has any reason to read a
 *      patient's history, and giving them the ability "because they are staff" is how a
 *      hospital ends up unable to say who looked at whom.
 *   2. **Facility.** The encounter must belong to the clinician's own hospital. This is
 *      not a UI concern: a record id from another site must not resolve here.
 *   3. **Department.** A doctor sees their own department's patients. Anything else needs
 *      break-glass, with a typed reason, recorded where a human will review it.
 *
 * A refusal is always the same code and status whether the encounter does not exist, is at
 * another hospital, or is in another department — a clinician trying ids must not be able
 * to learn which.
 */
@Injectable()
export class EncounterAccessService {
  private readonly logger = new Logger(EncounterAccessService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  async require(
    staff: StaffContext,
    encounterId: string,
    correlationId: string,
    breakGlassReason?: string,
  ): Promise<AccessibleEncounter> {
    if (staff.role !== 'CLINICIAN') {
      throw new DomainError('NOT_AUTHORISED', correlationId, `role ${staff.role} is not clinical`);
    }

    const row = await this.db
      .selectFrom('encounter')
      .innerJoin('department', 'department.id', 'encounter.department_id')
      .innerJoin('branch', 'branch.id', 'department.branch_id')
      .select([
        'encounter.id as encounterId',
        'encounter.patient_id as patientId',
        'encounter.department_id as departmentId',
        'encounter.pre_checkin_id as preCheckinId',
        'encounter.verified_at as verifiedAt',
        'branch.hospital_id as hospitalId',
      ])
      .where('encounter.id', '=', encounterId)
      .executeTakeFirst();

    // Absent and out-of-facility are the same refusal, deliberately.
    if (!row || row.hospitalId !== staff.hospitalId) {
      throw new DomainError('NOT_AUTHORISED', correlationId, 'unknown or out-of-facility record');
    }

    const ownDepartment = staff.departmentId === null || staff.departmentId === row.departmentId;
    if (!ownDepartment) {
      if (!breakGlassReason || breakGlassReason.trim().length < 10) {
        throw new DomainError(
          'NOT_AUTHORISED',
          correlationId,
          'outside department and no break-glass reason',
        );
      }
      await this.recordBreakGlass(staff, row.encounterId, breakGlassReason, correlationId);
    }

    return {
      encounterId: row.encounterId,
      patientId: row.patientId,
      departmentId: row.departmentId,
      preCheckinId: row.preCheckinId,
      verifiedAt: row.verifiedAt,
    };
  }

  private async recordBreakGlass(
    staff: StaffContext,
    encounterId: string,
    reason: string,
    correlationId: string,
  ): Promise<void> {
    await this.db
      .insertInto('break_glass_access')
      .values({
        staff_user_id: staff.userId,
        encounter_id: encounterId,
        reason: reason.trim(),
        correlation_id: correlationId,
      })
      .execute();

    // Warned, not just recorded. Break-glass is legitimate and rare; a burst of it is the
    // signal, and a signal nobody sees until someone runs a report is not a control.
    this.logger.warn(
      `BREAK-GLASS ${staff.displayName} (${staff.userId}) opened encounter ${encounterId} ` +
        `correlationId=${correlationId}`,
    );

    await this.audit.append({
      actorId: staff.userId,
      actorRole: staff.role,
      action: 'BREAK_GLASS_ACCESS',
      entityType: 'encounter',
      entityId: encounterId,
      correlationId,
      reason: reason.trim(),
    });
  }

  /** Records an ordinary read. Every view of a clinical record is logged. */
  async recordView(
    staff: StaffContext,
    encounterId: string,
    correlationId: string,
    what: string,
  ): Promise<void> {
    await this.audit.append({
      actorId: staff.userId,
      actorRole: staff.role,
      action: 'CLINICAL_RECORD_VIEWED',
      entityType: 'encounter',
      entityId: encounterId,
      correlationId,
      detail: { what },
    });
  }
}
