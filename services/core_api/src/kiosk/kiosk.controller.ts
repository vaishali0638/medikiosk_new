import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  endKioskSessionRequestSchema,
  selectLanguageRequestSchema,
  type EndKioskSessionRequest,
  type KioskConfigResponse,
  type KioskSession,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { KioskConfigService } from './kiosk-config.service';
import { KioskDeviceGuard, type KioskRequest } from './kiosk-device.guard';
import { KioskSessionRepository } from './kiosk-session.repository';
import type { KioskSessionRow } from '../db/database.types';

@ApiTags('kiosk')
@Controller('kiosk')
@UseGuards(KioskDeviceGuard)
export class KioskController {
  constructor(
    private readonly config: KioskConfigService,
    private readonly sessions: KioskSessionRepository,
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

  @Post('sessions/:id/activity')
  @ApiOperation({ summary: 'Record patient activity and reset the inactivity window.' })
  async recordActivity(@Req() req: KioskRequest, @Param('id') id: string): Promise<KioskSession> {
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
