import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  kioskConsentDecisionSchema,
  revokeConsentRequestSchema,
  type ConsentNotice,
  type ConsentResponse,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { ConsentNoticeService } from './consent-notice.service';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';
import type { ConsentRow } from '../db/database.types';

@ApiTags('consent')
@Controller('consents')
@UseGuards(KioskDeviceGuard)
export class ConsentController {
  constructor(
    private readonly consents: ConsentService,
    private readonly repository: ConsentRepository,
    private readonly notices: ConsentNoticeService,
    private readonly sessions: KioskSessionRepository,
  ) {}

  @Get('notice')
  @ApiOperation({
    summary: 'The published consent notice for a language. No cross-language fallback.',
  })
  async getNotice(
    @Req() req: KioskRequest,
    @Query('language') language?: string,
  ): Promise<ConsentNotice> {
    if (!language) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'language is required');
    }

    const notice = await this.notices.findPublished(req.kiosk.hospitalId, language);
    if (!notice) {
      // Asking a patient to agree to wording in a language they did not choose is not
      // consent, so an unpublished language blocks rather than falls back.
      throw new DomainError(
        'CONSENT_REQUIRED',
        req.correlationId,
        `no published consent notice for ${language}`,
      );
    }
    return notice;
  }

  @Post()
  @ApiOperation({ summary: 'Record a consent decision against the published notice.' })
  async capture(
    @Req() req: KioskRequest,
    @Body() body: unknown,
    @Query('sessionId') sessionId?: string,
  ): Promise<ConsentResponse> {
    const parsed = kioskConsentDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad consent payload');
    }

    // The session must be at the consent step. This is what stops a client skipping the
    // notice and posting a decision straight into an unrelated session state.
    if (sessionId) {
      await this.sessions.transition(sessionId, 'CONSENT_PENDING');
    }

    const row = await this.consents.capture({
      hospitalId: req.kiosk.hospitalId,
      language: parsed.data.language,
      decision: parsed.data.decision,
      captureMethod: 'KIOSK_TOUCH',
      kioskDeviceId: req.kiosk.deviceId,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    if (sessionId) {
      if (parsed.data.decision === 'GRANTED') {
        await this.sessions.transition(sessionId, 'CONSENT_GRANTED', {
          patient_id: row.patient_id,
        });
      } else {
        // A decline ends the kiosk intake outright. The artefact is kept; the session is
        // not left sitting at a step the patient has refused to complete.
        await this.sessions.end(sessionId, 'EXIT', req.kiosk.deviceCode, req.correlationId);
      }
    }

    return this.toResponse(row);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a consent artefact back.' })
  async getById(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<ConsentResponse> {
    const row = await this.repository.findById(id);
    // Scoped to the calling kiosk's hospital: a device must not be able to read consent
    // artefacts belonging to another facility.
    if (!row || row.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, `consent ${id} not visible`);
    }
    return this.toResponse(row);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Withdraw a granted consent. Recorded, never deleted.' })
  async revoke(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: unknown,
  ): Promise<ConsentResponse> {
    const parsed = revokeConsentRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad revoke payload');
    }

    const existing = await this.repository.findById(id);
    if (!existing || existing.hospital_id !== req.kiosk.hospitalId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, `consent ${id} not visible`);
    }

    const row = await this.repository.revoke(
      id,
      req.correlationId,
      `kiosk:${req.kiosk.deviceCode}`,
    );
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
