import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  kioskConsentDecisionSchema,
  requestOtpSchema,
  verifyOtpSchema,
  type ConsentNotice,
  type ConsentResponse,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { ConsentNoticeService } from '../consent/consent-notice.service';
import { ConsentService } from '../consent/consent.service';
import { OtpService } from '../identity/otp.service';
import { PatientChannelGuard, type PatientChannelRequest } from './patient-channel.guard';
import type { ConsentRow } from '../db/database.types';

/**
 * Endpoints the patient PWA calls from a phone, before arriving at the hospital.
 *
 * A deliberately small surface: read the consent notice, prove possession of a mobile
 * number, record a consent decision. Everything clinical happens after arrival, behind
 * the kiosk guard.
 */
@ApiTags('patient')
@Controller('patient')
@UseGuards(PatientChannelGuard)
export class PatientChannelController {
  constructor(
    private readonly notices: ConsentNoticeService,
    private readonly consents: ConsentService,
    private readonly otp: OtpService,
  ) {}

  @Get('hospital')
  @ApiOperation({ summary: 'Hospital name and the languages a notice is published in.' })
  async getHospital(@Req() req: PatientChannelRequest): Promise<unknown> {
    const languages = await this.notices.publishedLanguages(req.hospital.hospitalId);
    return {
      hospitalId: req.hospital.hospitalCode,
      hospitalName: req.hospital.hospitalName,
      languages,
    };
  }

  @Get('consents/notice')
  @ApiOperation({ summary: 'The published consent notice. No cross-language fallback.' })
  async getNotice(
    @Req() req: PatientChannelRequest,
    @Query('language') language?: string,
  ): Promise<ConsentNotice> {
    if (!language) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'language is required');
    }

    const notice = await this.notices.findPublished(req.hospital.hospitalId, language);
    if (!notice) {
      throw new DomainError(
        'CONSENT_REQUIRED',
        req.correlationId,
        `no published consent notice for ${language}`,
      );
    }
    return notice;
  }

  @Post('otp')
  @ApiOperation({
    summary: 'Send a one-time code. Identical response whether or not the number is known.',
  })
  async requestOtp(@Req() req: PatientChannelRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = requestOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad otp request');
    }

    const issued = await this.otp.issue({
      hospitalId: req.hospital.hospitalId,
      mobile: parsed.data.mobile,
      purpose: parsed.data.purpose,
      correlationId: req.correlationId,
      actorId: 'patient:pwa',
    });

    return {
      verificationId: issued.verificationId,
      maskedMobile: issued.maskedMobile,
      expiresAt: issued.expiresAt.toISOString(),
      attemptsAllowed: issued.attemptsAllowed,
    };
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verify a one-time code. Attempts are limited, then locked.' })
  async verifyOtp(@Req() req: PatientChannelRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad verify request');
    }

    await this.otp.verify(
      parsed.data.verificationId,
      parsed.data.code,
      req.correlationId,
      'patient:pwa',
    );
    return { verificationId: parsed.data.verificationId, verified: true };
  }

  @Post('consents')
  @ApiOperation({ summary: 'Record a consent decision against the published notice.' })
  async captureConsent(
    @Req() req: PatientChannelRequest,
    @Body() body: unknown,
  ): Promise<ConsentResponse> {
    const parsed = kioskConsentDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad consent payload');
    }

    const row = await this.consents.capture({
      hospitalId: req.hospital.hospitalId,
      language: parsed.data.language,
      decision: parsed.data.decision,
      // Recorded distinctly from a kiosk capture: where consent was given is part of the
      // evidence of how it was given.
      captureMethod: 'MOBILE_PWA',
      correlationId: req.correlationId,
      actorId: 'patient:pwa',
    });

    return this.toResponse(row);
  }

  private toResponse(row: ConsentRow): ConsentResponse {
    return {
      consentId: row.id,
      patientId: row.patient_id,
      hospitalId: row.hospital_id,
      purpose: row.purpose as ConsentResponse['purpose'],
      dataCategories: row.data_categories,
      language: row.language_tag,
      noticeVersion: row.notice_version,
      status: row.state,
      capturedAt: row.captured_at.toISOString(),
      validUntil: new Date(row.valid_until).toISOString(),
      captureMethod: row.capture_method,
    };
  }
}
