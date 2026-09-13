import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { ConsentService } from '../consent/consent.service';
import { PreCheckinService } from '../precheckin/precheckin.service';
import { FOLLOW_UP_SECTIONS, FollowUpService } from './followup.service';
import { VerifiedVisitService } from './verified-visit.service';

const recordDeltaSchema = z.object({
  changes: z
    .array(
      z.object({
        section: z.enum(FOLLOW_UP_SECTIONS),
        detail: z.string().max(1000).optional(),
      }),
    )
    .max(20),
});

@ApiTags('followup')
@Controller()
@UseGuards(KioskDeviceGuard)
export class FollowUpController {
  constructor(
    private readonly followUps: FollowUpService,
    private readonly verified: VerifiedVisitService,
    private readonly consents: ConsentService,
    private readonly preCheckins: PreCheckinService,
  ) {}

  @Get('precheckins/:preCheckinId/previous-visit')
  @ApiOperation({
    summary:
      'The last clinician-verified visit for this patient, or null. Never an AI draft: ' +
      'the query requires a verified encounter and a CLINICIAN-VERIFIED record.',
  })
  async previousVisit(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
  ): Promise<unknown> {
    const visit = await this.requireVisit(req, preCheckinId);
    const previous = await this.verified.lastVerifiedFor(visit.patient_id);

    // Null is a normal answer, not an error. A first-time patient has no verified history,
    // and neither does one whose previous visit no clinician has signed off yet — both
    // get a full intake rather than a follow-up.
    if (!previous) return { hasPreviousVerifiedVisit: false };

    return {
      hasPreviousVerifiedVisit: true,
      verifiedAt: previous.verifiedAt,
      department: previous.departmentName,
      provenance: PROVENANCE_LABELS.CLINICIAN_VERIFIED,
      // The record itself, so a clinician can inspect what is being carried forward
      // rather than trusting a summary of a summary.
      record: previous.record,
    };
  }

  @Post('precheckins/:preCheckinId/follow-up')
  @ApiOperation({
    summary:
      'Record what changed since the last verified visit. Replaces any previous delta ' +
      'for this visit, so a patient may go back and correct it.',
  })
  async record(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = recordDeltaSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad follow-up payload');
    }

    const visit = await this.requireVisit(req, preCheckinId);
    await this.consents.requireActiveConsent(visit.patient_id, req.correlationId);

    const result = await this.followUps.record({
      preCheckinId,
      patientId: visit.patient_id,
      changes: parsed.data.changes,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    return {
      previousVerifiedAt: result.baseline.verifiedAt,
      itemCount: result.itemCount,
    };
  }

  @Get('precheckins/:preCheckinId/delta')
  @ApiOperation({
    summary:
      'The follow-up as a clinician reads it: unchanged, changed and not-confirmed, ' +
      'kept apart. Never one merged list.',
  })
  async delta(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
  ): Promise<unknown> {
    await this.requireVisit(req, preCheckinId);
    const delta = await this.followUps.deltaFor(preCheckinId);
    if (!delta) return { hasDelta: false };

    return {
      hasDelta: true,
      previousVerifiedVisit: {
        verifiedAt: delta.previousVerifiedAt,
        department: delta.previousDepartment,
      },
      // Three arrays, never concatenated. A doctor needs to tell what was carried forward
      // from a record they signed from what the patient said five minutes ago.
      unchanged: delta.unchanged,
      changed: delta.changed,
      notConfirmed: delta.notConfirmed,
    };
  }

  private async requireVisit(
    req: KioskRequest,
    preCheckinId: string,
  ): Promise<{ patient_id: string }> {
    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin || preCheckin.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'unknown pre-check-in');
    }
    return preCheckin;
  }
}
