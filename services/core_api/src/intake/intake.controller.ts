import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NON_COMMITTAL_ANSWERS } from '@medikiosk/questionnaire-schema';
import { DomainError } from '../common/domain-error';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { ConsentService } from '../consent/consent.service';
import { AnswerRepository } from './answer.repository';
import { QuestionnaireService } from './questionnaire.service';
import { PreCheckinService } from '../precheckin/precheckin.service';

const COMMON_CORE_KEY = 'common-core';

/**
 * An answer, as the kiosk submits it.
 *
 * `source` and `modality` are required, not defaulted. Every clinical value has to say
 * where it came from, and a default would quietly label a voice transcription as a touch
 * selection the moment someone forgot to set it.
 */
const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  /** Option ids, or `["NOT_SURE"]` and friends. Empty for a free-text answer. */
  selectedOptionIds: z.array(z.string().min(1)).default([]),
  /** Free text, a scale value, a date, or a duration band id. */
  value: z.union([z.string().max(2000), z.number(), z.null()]).optional(),
  source: z.enum(['PATIENT_SELECTED', 'PATIENT_REPORTED']),
  modality: z.enum(['TOUCH', 'VOICE', 'TEXT']),
  language: z.string().min(2).max(16),
});

@ApiTags('intake')
@Controller('intakes')
@UseGuards(KioskDeviceGuard)
export class IntakeController {
  constructor(
    private readonly questionnaires: QuestionnaireService,
    private readonly answers: AnswerRepository,
    private readonly consents: ConsentService,
    private readonly preCheckins: PreCheckinService,
  ) {}

  @Get('ayush-systems')
  @ApiOperation({
    summary:
      'AYUSH systems this hospital can run an intake for: an enabled department AND a ' +
      'published, approved module.',
  })
  async ayushSystems(
    @Req() req: KioskRequest,
    @Query('language') language?: string,
  ): Promise<{ systems: string[] }> {
    return {
      systems: await this.questionnaires.availableAyushSystems(
        req.kiosk.hospitalId,
        language ?? 'en',
      ),
    };
  }

  @Get(':preCheckinId/next')
  @ApiOperation({
    summary: 'The next approved question, chosen by deterministic rules over the answers so far.',
  })
  async next(
    @Req() req: KioskRequest,
    @Param('preCheckinId') preCheckinId: string,
    @Query('language') language?: string,
  ): Promise<unknown> {
    const { questionnaire, lookup, moduleUsed } = await this.load(req, preCheckinId, language);
    const next = this.questionnaires.next(questionnaire, lookup);

    if (!next) {
      return {
        complete: true,
        questionnaireKey: questionnaire.key,
        questionnaireVersion: questionnaire.version,
        ayushModule: moduleUsed,
      };
    }

    return {
      complete: false,
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      ayushModule: moduleUsed,
      answeredCount: next.answeredCount,
      totalApplicable: next.totalApplicable,
      question: next.question,
    };
  }

  @Post(':preCheckinId/answers')
  @ApiOperation({ summary: 'Record an answer as a new revision. Answers never overwrite.' })
  async answer(
    @Req() req: KioskRequest,
    @Param('preCheckinId') preCheckinId: string,
    @Body() body: unknown,
    @Query('language') language?: string,
  ): Promise<unknown> {
    const parsed = submitAnswerSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad answer payload');
    }

    const { questionnaire, preCheckin } = await this.load(req, preCheckinId, language);
    const question = this.questionnaires.requireQuestion(
      questionnaire,
      parsed.data.questionId,
      req.correlationId,
    );

    const nonCommittal = parsed.data.selectedOptionIds.filter((id) =>
      (NON_COMMITTAL_ANSWERS as readonly string[]).includes(id),
    );

    // A non-committal answer is exclusive: "not sure, and also knee pain" is not a
    // coherent record, and storing both would leave the doctor to guess which is meant.
    if (nonCommittal.length > 0 && parsed.data.selectedOptionIds.length > nonCommittal.length) {
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        'a non-committal answer cannot be combined with a substantive one',
      );
    }

    if (nonCommittal.length > 0 && !question.nonCommittal.includes(nonCommittal[0] as never)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        `question ${question.id} does not offer ${nonCommittal[0]}`,
      );
    }

    // A substantive answer must name options the published question actually offers.
    //
    // The `?? []` matters. A question with no options at all — a numeric scale, a date,
    // free text — offers nothing, so any option id sent against it is unknown. Treating a
    // missing `options` as "no constraint" instead let an arbitrary identifier through,
    // and it surfaced later as a quoted phrase in the clinician's draft attributed to the
    // patient: `Patient reported: "moderate"`, where `moderate` was never a word anyone
    // showed them.
    if (nonCommittal.length === 0) {
      const offered = new Set((question.options ?? []).map((o) => o.id));
      const unknown = parsed.data.selectedOptionIds.filter((id) => !offered.has(id));
      if (unknown.length > 0) {
        throw new DomainError(
          'VALIDATION_FAILED',
          req.correlationId,
          `question ${question.id} does not offer options: ${unknown.join(', ')}`,
        );
      }
    }

    const revision = await this.answers.record({
      preCheckinId: preCheckin.id,
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      questionId: question.id,
      value: parsed.data.value ?? null,
      selectedOptionIds: parsed.data.selectedOptionIds,
      source: parsed.data.source,
      modality: parsed.data.modality,
      languageTag: parsed.data.language,
    });

    return { questionId: question.id, revision };
  }

  @Get(':preCheckinId/answers')
  @ApiOperation({
    summary: 'The structured answers for the review screen, each with its provenance.',
  })
  async review(
    @Req() req: KioskRequest,
    @Param('preCheckinId') preCheckinId: string,
    @Query('language') language?: string,
  ): Promise<unknown> {
    const { questionnaire, lookup, moduleUsed } = await this.load(req, preCheckinId, language);
    const answers = await this.answers.latest(preCheckinId);
    const byId = new Map(answers.map((a) => [a.questionId, a]));

    // Ordered by the questionnaire, not by when the patient answered: the review screen
    // should read like the interview, not like a log.
    const items = this.questionnaires.applicable(questionnaire, lookup).map((question) => {
      const answer = byId.get(question.id);
      return {
        questionId: question.id,
        prompt: question.prompt,
        answered: answer !== undefined,
        selectedOptionIds: answer?.selectedOptionIds ?? [],
        value: answer?.value ?? null,
        // The label every answer carries into the doctor's view.
        source: answer?.source ?? null,
        modality: answer?.modality ?? null,
        revision: answer?.revision ?? 0,
        labels: (answer?.selectedOptionIds ?? []).map(
          (id) => question.options?.find((o) => o.id === id)?.label ?? id,
        ),
      };
    });

    return {
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      ayushModule: moduleUsed,
      complete: items.every((item) => item.answered),
      items,
    };
  }

  /**
   * Loads the questionnaire and the answers so far, having checked consent first.
   *
   * Consent is re-checked on EVERY call, not once at the start of the interview. A patient
   * can withdraw mid-intake, and the next question must not be served after they have.
   */
  private async load(req: KioskRequest, preCheckinId: string, language?: string) {
    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin || preCheckin.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'unknown pre-check-in');
    }

    await this.consents.requireActiveConsent(preCheckin.patient_id, req.correlationId);

    const tag = language ?? 'en';

    // The AYUSH system is DERIVED from the department the visit is booked into, never
    // taken from the request. Two reasons: a client cannot switch the interview
    // underneath a patient by sending a different system on the next call, and there is
    // only one place the system is recorded, so it cannot disagree with itself.
    const ayushSystem = await this.questionnaires.systemForDepartment(preCheckin.department_id);

    const composed = await this.questionnaires.findComposed(
      req.kiosk.hospitalId,
      COMMON_CORE_KEY,
      tag,
      ayushSystem,
    );

    if (!composed) {
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        `no published questionnaire for ${tag}`,
      );
    }

    return {
      preCheckin,
      questionnaire: composed.questionnaire,
      moduleUsed: composed.moduleUsed,
      lookup: await this.answers.lookup(preCheckinId),
    };
  }
}
