import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  draftBannerFor,
  PATIENT_FACING_SUMMARY_LABEL,
  PROVENANCE_LABELS,
} from '@medikiosk/terminology';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { ConsentService } from '../consent/consent.service';
import { PreCheckinService } from '../precheckin/precheckin.service';
import { KioskVisitService } from '../kiosk/kiosk-visit.service';
import { ARRIVAL_HANDLE_TTL_SECONDS } from '../arrival/arrival.service';
import { ReviewService } from './review.service';
import { SummaryService } from './summary.service';
import { SubmissionService } from './submission.service';

const submitSchema = z.object({
  /**
   * Must be literally true. Not a boolean with a default, and not inferred from the fact
   * that the request was sent: the exit criterion is that a patient cannot submit without
   * confirming their review, and a defaulted flag is a confirmation nobody gave.
   */
  reviewConfirmed: z.literal(true),
  language: z.string().min(2).max(16),
  corrections: z
    .array(
      z.object({
        questionId: z.string().min(1).max(64),
        fromRevision: z.number().int().nonnegative(),
        toRevision: z.number().int().positive(),
      }),
    )
    .max(100)
    .default([]),
});

@ApiTags('summary')
@Controller()
@UseGuards(KioskDeviceGuard)
export class SummaryController {
  constructor(
    private readonly review: ReviewService,
    private readonly summaries: SummaryService,
    private readonly submissions: SubmissionService,
    private readonly consents: ConsentService,
    private readonly preCheckins: PreCheckinService,
    private readonly visits: KioskVisitService,
  ) {}

  @Get('precheckins/:preCheckinId/review')
  @ApiOperation({
    summary:
      'What the patient checks before submitting: their own answers, each with a ' +
      'provenance label, and nothing derived.',
  })
  async patientReview(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
    @Query('language') language?: string,
  ): Promise<unknown> {
    const preCheckin = await this.requireVisit(req, preCheckinId);
    await this.consents.requireActiveConsent(preCheckin.patient_id, req.correlationId);

    const material = await this.review.gather(preCheckinId, language ?? 'en', req.correlationId);
    const submission = await this.submissions.findByPreCheckin(preCheckinId);

    return {
      // The patient's banner. Not "AI summary", not "your diagnosis" — this screen shows
      // them what they said, so it is labelled as what they said.
      heading: PATIENT_FACING_SUMMARY_LABEL,
      questionnaireKey: material.questionnaireKey,
      questionnaireVersion: material.questionnaireVersion,
      ayushModuleVersion: material.ayushModuleVersion,
      language: material.language,
      items: material.items,
      documents: material.documents,
      /** Every provenance label the patient may see on this screen, for the legend. */
      labels: {
        patientReported: PROVENANCE_LABELS.PATIENT_REPORTED,
        patientSelected: PROVENANCE_LABELS.PATIENT_SELECTED,
        sourceDocument: PROVENANCE_LABELS.SOURCE_DOCUMENT,
        ocrExtracted: PROVENANCE_LABELS.OCR_EXTRACTED,
      },
      submitted: submission !== null,
      submittedAt: submission?.submittedAt ?? null,
    };
  }

  @Post('precheckins/:preCheckinId/submit-intake')
  @ApiOperation({
    summary:
      'Records the patient’s confirmed review and produces the clinician draft. ' +
      'Idempotent; refuses without confirmation.',
  })
  async submit(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      // Includes the case that matters: reviewConfirmed absent or false.
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        'submission requires a confirmed review',
      );
    }

    const preCheckin = await this.requireVisit(req, preCheckinId);
    const consent = await this.consents.requireActiveConsent(
      preCheckin.patient_id,
      req.correlationId,
    );

    const material = await this.review.gather(
      preCheckinId,
      parsed.data.language,
      req.correlationId,
    );

    const submission = await this.submissions.submit({
      preCheckinId,
      consentId: consent.id,
      kioskDeviceId: req.kiosk.deviceId,
      questionnaireKey: material.questionnaireKey,
      questionnaireVersion: material.questionnaireVersion,
      ayushModuleVersion: material.ayushModuleVersion ?? undefined,
      languageTag: material.language,
      reviewConfirmed: parsed.data.reviewConfirmed,
      answerRevisions: material.answerRevisions,
      corrections: parsed.data.corrections,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    // Drafted after the submission is recorded, not before. The submission is the
    // patient's act and must not depend on a generator; if drafting failed entirely, the
    // visit still happened and a clinician still has the structured answers.
    const draft = await this.summaries.generate(
      preCheckinId,
      material.composeInput,
      material.grounding,
      req.correlationId,
      `kiosk:${req.kiosk.deviceCode}`,
    );

    // A walk-in has no QR and so no arrival scan. Their presence is established by the
    // fact that this entire intake just happened on this device, so the arrival is
    // confirmed here and the token step is addressed through the same rotated handle the
    // mobile path uses. A mobile pre-check-in reaching this endpoint gets no handle: it
    // must still be scanned, and `confirmWalkInArrival` refuses it.
    let tokenHandle: string | null = null;
    if (preCheckin.kiosk_session_id !== null) {
      tokenHandle = await this.visits.confirmWalkInArrival({
        preCheckinId,
        kioskDeviceId: req.kiosk.deviceId,
        correlationId: req.correlationId,
        actorId: `kiosk:${req.kiosk.deviceCode}`,
        handleTtlSeconds: ARRIVAL_HANDLE_TTL_SECONDS,
      });
    }

    return {
      submissionId: submission.submissionId,
      submittedAt: submission.submittedAt,
      alreadySubmitted: submission.alreadySubmitted,
      tokenHandle,
      summaryId: draft.summaryId,
      // Returned so a client cannot render the draft without also having the label in
      // hand. A client that wants to show the text has been given the banner with it.
      draftLabel: draftBannerFor(draft.generator),
      generator: draft.generator,
      fellBackToRules: draft.fellBack,
    };
  }

  @Get('precheckins/:preCheckinId/draft')
  @ApiOperation({
    summary:
      'The pre-consultation draft. Banner names what produced it — a model or the ' +
      'deterministic composer — and both say NOT VERIFIED. Nothing in it is a clinical ' +
      'record until a clinician says so.',
  })
  async draft(
    @Req() req: KioskRequest,
    @Param('preCheckinId', UuidParamPipe) preCheckinId: string,
  ): Promise<unknown> {
    await this.requireVisit(req, preCheckinId);

    const latest = await this.summaries.latestFor(preCheckinId);
    if (!latest) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'no draft for this visit');
    }

    return {
      summaryId: latest.summaryId,
      // Two labels, deliberately: the banner a human reads, and the machine-readable
      // provenance value that must travel with the content into any other system.
      banner: draftBannerFor(latest.generator),
      provenance: latest.label,
      generator: latest.generator,
      generatorVersion: latest.generatorVersion,
      sections: latest.draft.sections,
      narrative: latest.draft.narrative,
    };
  }

  private async requireVisit(
    req: KioskRequest,
    preCheckinId: string,
  ): Promise<{ patient_id: string; kiosk_session_id: string | null }> {
    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin || preCheckin.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'unknown pre-check-in');
    }
    return preCheckin;
  }
}
