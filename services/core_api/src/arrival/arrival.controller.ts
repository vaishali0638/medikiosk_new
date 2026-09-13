import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  arrivalCheckInRequestSchema,
  arrivalConfirmRequestSchema,
  type ArrivalCheckInResponse,
  type ArrivalStatusResponse,
  type TokenResponse,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { ArrivalService } from './arrival.service';
import { TokenService } from './token.service';

@ApiTags('arrival')
@Controller('arrival')
@UseGuards(KioskDeviceGuard)
export class ArrivalController {
  constructor(
    private readonly arrivals: ArrivalService,
    private readonly tokens: TokenService,
    private readonly sessions: KioskSessionRepository,
  ) {}

  @Post('check-in')
  @ApiOperation({
    summary: 'Validate a scanned QR. Discloses nothing on any failure path.',
  })
  async checkIn(@Req() req: KioskRequest, @Body() body: unknown): Promise<ArrivalCheckInResponse> {
    const parsed = arrivalCheckInRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('QR_INVALID', req.correlationId, 'bad check-in payload');
    }

    const candidate = await this.arrivals.checkIn(
      parsed.data.qrPayload,
      req.kiosk,
      req.correlationId,
    );

    return {
      arrivalId: candidate.arrivalHandle,
      masked: {
        maskedName: candidate.maskedName,
        maskedMobile: candidate.maskedMobile,
      },
      hospitalName: candidate.hospitalName,
      departmentName: candidate.departmentName,
      visitTypeLabel:
        candidate.visitType === 'REGULAR_FOLLOW_UP' ? 'Regular follow-up' : 'New complaint',
    };
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm the masked visit and declare what has changed.' })
  async confirm(
    @Req() req: KioskRequest,
    @Param('id', UuidParamPipe) arrivalHandle: string,
    @Body() body: unknown,
  ): Promise<{ tokenHandle: string; changedSections: readonly string[] }> {
    const parsed = arrivalConfirmRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad confirm payload');
    }

    const result = await this.arrivals.confirm(
      arrivalHandle,
      parsed.data,
      req.kiosk,
      req.correlationId,
    );

    // The session is LINKED to the visit, not advanced through the intake states.
    //
    // Those states describe the kiosk-hosted journey — language, consent, identity,
    // intake, review. A mobile-QR patient did all of that at home, so their kiosk session
    // sits in CREATED and driving it to IDENTITY_CONFIRMED is not a shortcut but a false
    // claim: it would assert the kiosk captured consent it never showed. The authority
    // for this journey is the pre-check-in's own state machine, which has just reached
    // ARRIVAL_CONFIRMED, and the consent artefact the QR was validated against.
    const session = await this.sessions.findLatestOpenForDevice(req.kiosk.deviceId);
    if (session) await this.sessions.attachPreCheckin(session.id, result.preCheckinId);

    // The pre-check-in id is deliberately NOT returned: the kiosk addresses the token
    // step through a rotated handle, so a bystander who read the id off a photographed
    // QR cannot request the token.
    return { tokenHandle: result.tokenHandle, changedSections: result.changedSections };
  }

  @Post(':handle/token')
  @ApiOperation({
    summary:
      'Request the hospital token. The HIS issues it; MediKiosk never invents one, and ' +
      'never issues a second for the same visit.',
  })
  async requestToken(
    @Req() req: KioskRequest,
    @Param('handle', UuidParamPipe) handle: string,
  ): Promise<TokenResponse> {
    const preCheckinId = await this.arrivals.resolveTokenHandle(handle, req.correlationId);
    // Same reasoning as confirm: the token belongs to the visit, not to the kiosk
    // session, and marching a CREATED session through five states it never visited would
    // put fiction in the audit trail.
    return this.tokens.requestToken(preCheckinId, req.kiosk, req.correlationId);
  }

  @Get(':handle/status')
  @ApiOperation({ summary: 'Poll the recorded outcome. Never contacts the HIS.' })
  async status(
    @Req() req: KioskRequest,
    @Param('handle', UuidParamPipe) handle: string,
  ): Promise<ArrivalStatusResponse> {
    const preCheckinId = await this.arrivals.resolveTokenHandle(handle, req.correlationId);
    const status = await this.tokens.getStatus(preCheckinId, req.kiosk);

    return {
      arrivalId: handle,
      tokenState: status.tokenState as ArrivalStatusResponse['tokenState'],
      ...(status.token ? { token: status.token } : {}),
      reconciliationRequired: status.reconciliationRequired,
    };
  }
}
