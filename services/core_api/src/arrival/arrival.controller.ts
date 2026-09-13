import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  arrivalCheckInRequestSchema,
  arrivalConfirmRequestSchema,
  type ArrivalCheckInResponse,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { ArrivalService } from './arrival.service';

@ApiTags('arrival')
@Controller('arrival')
@UseGuards(KioskDeviceGuard)
export class ArrivalController {
  constructor(
    private readonly arrivals: ArrivalService,
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
    @Param('id') arrivalHandle: string,
    @Body() body: unknown,
  ): Promise<{ preCheckinId: string; changedSections: readonly string[] }> {
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

    // The kiosk session, if one is running, follows the arrival: a confirmed arrival is a
    // confirmed identity, since the QR was bound to this patient's pre-check-in.
    const session = await this.sessions.findLatestOpenForDevice(req.kiosk.deviceId);
    if (session) {
      await this.sessions.transition(session.id, 'IDENTITY_PENDING');
      await this.sessions.transition(session.id, 'IDENTITY_CONFIRMED', {
        pre_checkin_id: result.preCheckinId,
      });
    }

    return result;
  }
}
