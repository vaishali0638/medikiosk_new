import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  VISIT_TYPES,
  endKioskSessionRequestSchema,
  selectLanguageRequestSchema,
  type EndKioskSessionRequest,
  type KioskConfigResponse,
  type KioskSession,
} from '@medikiosk/api-contracts';
import { z } from 'zod';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskConfigService } from './kiosk-config.service';
import { KioskVisitService } from './kiosk-visit.service';
import { KioskDeviceGuard, type KioskRequest } from './kiosk-device.guard';
import { KioskSessionRepository } from './kiosk-session.repository';
import { VerifiedVisitService } from '../followup/verified-visit.service';
import type { KioskSessionRow } from '../db/database.types';

const openVisitSchema = z.object({
  /** The department this kiosk stands outside, or the one the AYUSH choice maps to. */
  departmentCode: z.string().min(1).max(64),
  /**
   * Why the patient is here. Optional, defaulting to NEW_COMPLAINT, because a client that
   * has not been updated must keep working rather than start failing.
   */
  visitType: z.enum(VISIT_TYPES).optional(),
});

@ApiTags('kiosk')
@Controller('kiosk')
@UseGuards(KioskDeviceGuard)
export class KioskController {
  constructor(
    private readonly config: KioskConfigService,
    private readonly sessions: KioskSessionRepository,
    private readonly verified: VerifiedVisitService,
    private readonly visits: KioskVisitService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Languages, departments, AYUSH systems, feature flags and content versions.',
  })
  async getConfig(@Req() req: KioskRequest): Promise<KioskConfigResponse> {
    return this.config.build(req.kiosk);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Start a kiosk session.' })
  async startSession(@Req() req: KioskRequest): Promise<KioskSession> {
    const row = await this.sessions.start(
      req.kiosk.deviceId,
      req.kiosk.deviceCode,
      req.correlationId,
    );
    return this.toResponse(row);
  }

  @Get('sessions/:id/previous-visit')
  @ApiOperation({
    summary:
      'Whether the patient on this session has a visit a clinician has verified. Decides ' +
      'only whether the kiosk OFFERS a follow-up; the server checks again when the visit ' +
      'is opened.',
  })
  async sessionPreviousVisit(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ hasPreviousVerifiedVisit: boolean }> {
    const session = await this.sessions.findById(id);

    // Keyed on the SESSION, and answered only for a session belonging to THIS device. A patient id in this URL would turn the kiosk into a way to ask
    // whether an arbitrary person has been treated here — which is a clinical disclosure,
    // from an unauthenticated device in a public corridor.
    if (!session || session.kiosk_device_id !== req.kiosk.deviceId || !session.patient_id) {
      return { hasPreviousVerifiedVisit: false };
    }

    const previous = await this.verified.lastVerifiedFor(session.patient_id);
    // Deliberately a bare boolean. When and where they were last seen is the follow-up
    // screen's business, after the visit exists; here it would be disclosure for nothing.
    return { hasPreviousVerifiedVisit: previous !== null };
  }

  @Post('sessions/:id/visit')
  @ApiOperation({
    summary:
      'Opens the visit for a walk-in patient whose identity is confirmed. Idempotent ' +
      'per session; the patient is taken from the session, never from the body.',
  })
  async openVisit(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ preCheckinId: string; departmentId: string }> {
    const parsed = openVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad visit payload');
    }

    const row = await this.visits.open({
      sessionId: id,
      departmentCode: parsed.data.departmentCode,
      visitType: parsed.data.visitType,
      hospitalId: req.kiosk.hospitalId,
      branchId: req.kiosk.branchId,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });
    await this.visits.beginIntake(id);

    return { preCheckinId: row.id, departmentId: row.department_id };
  }

  @Post('sessions/:id/activity')
  @ApiOperation({ summary: 'Record patient activity and reset the inactivity window.' })
  async recordActivity(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<KioskSession> {
    const row = await this.sessions.touch(id);
    // A session that has already ended must not be revivable: the wipe already ran, and
    // resuming would put the previous patient's flow back in front of the next one.
    if (!row) throw new DomainError('SESSION_EXPIRED', req.correlationId, `session ${id} closed`);
    return this.toResponse(row);
  }

  @Post('sessions/:id/language')
  @ApiOperation({ summary: 'Record the selected language for this session.' })
  async selectLanguage(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: unknown,
  ): Promise<KioskSession> {
    const parsed = selectLanguageRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad language payload');
    }

    const config = await this.config.build(req.kiosk);
    // Only a clinically reviewed language the hospital actually offers. A client that
    // asks for anything else is refused rather than silently falling back to English,
    // which would leave a patient reading a language they did not choose.
    if (!config.languages.some((l) => l.tag === parsed.data.language)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        `language not offered: ${parsed.data.language}`,
      );
    }

    const row = await this.sessions.transition(id, 'LANGUAGE_SELECTED', {
      language_tag: parsed.data.language,
    });
    return this.toResponse(row);
  }

  @Post('sessions/:id/end')
  @ApiOperation({ summary: 'End a session. Requires the client to attest that it wiped.' })
  async endSession(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ sessionId: string; state: string; endedAt: string }> {
    const parsed = endKioskSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // `wiped: true` is required by the schema. Rejecting here means a client that
      // failed to clear itself cannot quietly close the session as if it had.
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        'session end requires a wipe attestation',
      );
    }

    const request: EndKioskSessionRequest = parsed.data;
    const row = await this.sessions.end(
      id,
      request.reason,
      req.kiosk.deviceCode,
      req.correlationId,
    );

    return {
      sessionId: row.id,
      state: row.state,
      endedAt: (row.ended_at ?? new Date()).toISOString(),
    };
  }

  private toResponse(row: KioskSessionRow): KioskSession {
    const lastActivity = row.last_activity_at.getTime();
    const warnMs = this.config.inactivityWarningSeconds * 1000;
    const wipeMs = this.config.inactivityWipeSeconds * 1000;

    return {
      sessionId: row.id,
      state: row.state,
      startedAt: row.started_at.toISOString(),
      warnAt: new Date(lastActivity + warnMs).toISOString(),
      expiresAt: new Date(lastActivity + warnMs + wipeMs).toISOString(),
    };
  }
}
