import { Body, Controller, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  confirmIdentitySchema,
  registerPatientSchema,
  requestOtpSchema,
  resolveIdentitySchema,
  verifyOtpSchema,
  type ResolveIdentityResponse,
} from '@medikiosk/api-contracts';
import { DomainError } from '../common/domain-error';
import { RateLimitService } from '../security/rate-limit.service';
import { KioskDeviceGuard, type KioskRequest } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { IdentityService, type ResolveContext } from './identity.service';
import { OtpService } from './otp.service';
import { RegistrationService } from './registration.service';

@ApiTags('identity')
@Controller('identity')
@UseGuards(KioskDeviceGuard)
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly otp: OtpService,
    private readonly registration: RegistrationService,
    private readonly sessions: KioskSessionRepository,
    private readonly rateLimits: RateLimitService,
  ) {}

  @Post('otp')
  @ApiOperation({
    summary:
      'Send a one-time code. The response is identical whether or not the number is registered.',
  })
  async requestOtp(@Req() req: KioskRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = requestOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad otp request');
    }

    // Per DEVICE. Sends per number are already limited inside OtpService, and this is the
    // case that check cannot see: one kiosk walking through a list of numbers, each of
    // them under its own limit.
    await this.rateLimits.consume('OTP_REQUEST_PER_KIOSK', req.kiosk.deviceCode);

    const issued = await this.otp.issue({
      hospitalId: req.kiosk.hospitalId,
      kioskDeviceId: req.kiosk.deviceId,
      mobile: parsed.data.mobile,
      purpose: parsed.data.purpose,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    return {
      verificationId: issued.verificationId,
      maskedMobile: issued.maskedMobile,
      expiresAt: issued.expiresAt.toISOString(),
      attemptsAllowed: issued.attemptsAllowed,
    };
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verify a one-time code. Attempts are limited and then locked.' })
  async verifyOtp(@Req() req: KioskRequest, @Body() body: unknown): Promise<unknown> {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad verify request');
    }

    await this.otp.verify(
      parsed.data.verificationId,
      parsed.data.code,
      req.correlationId,
      `kiosk:${req.kiosk.deviceCode}`,
    );

    return { verificationId: parsed.data.verificationId, verified: true };
  }

  @Post('resolve')
  @ApiOperation({
    summary: 'Resolve a patient. Returns masked details only; refuses anything ambiguous.',
  })
  async resolve(
    @Req() req: KioskRequest,
    @Body() body: unknown,
    @Query('sessionId') sessionId?: string,
  ): Promise<ResolveIdentityResponse> {
    const parsed = resolveIdentitySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad resolve request');
    }

    if (sessionId) await this.sessions.transition(sessionId, 'IDENTITY_PENDING');

    const candidate = await this.identity.resolve(parsed.data, this.context(req, sessionId));

    return {
      candidateId: candidate.candidateId,
      method: candidate.method,
      strength: candidate.strength,
      masked: {
        maskedName: candidate.maskedName,
        maskedMobile: candidate.maskedMobile,
      },
      ...(candidate.maskedUhid ? { maskedUhid: candidate.maskedUhid } : {}),
      expiresAt: candidate.expiresAt.toISOString(),
    };
  }

  @Post('confirm')
  @ApiOperation({ summary: 'The patient confirms the masked details shown are their own.' })
  async confirm(
    @Req() req: KioskRequest,
    @Body() body: unknown,
    @Query('sessionId') sessionId?: string,
  ): Promise<unknown> {
    const parsed = confirmIdentitySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad confirm request');
    }

    const candidate = await this.identity.confirm(
      parsed.data.candidateId,
      this.context(req, sessionId),
    );

    if (sessionId) {
      await this.sessions.transition(sessionId, 'IDENTITY_CONFIRMED', {
        patient_id: candidate.patientId,
      });
    }

    return { patientId: candidate.patientId, strength: candidate.strength };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new patient by promoting the provisional record.' })
  async register(
    @Req() req: KioskRequest,
    @Body() body: unknown,
    @Query('sessionId') sessionId?: string,
  ): Promise<unknown> {
    const parsed = registerPatientSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'bad registration');
    }
    if (!parsed.data.dateOfBirth && parsed.data.ageYears === undefined) {
      throw new DomainError(
        'VALIDATION_FAILED',
        req.correlationId,
        'a date of birth or an age is required',
      );
    }
    if (!sessionId) {
      throw new DomainError('VALIDATION_FAILED', req.correlationId, 'sessionId is required');
    }

    // The provisional patient comes from the session, which got it from the consent step.
    // Taking it from the request body would let a client point a registration at any
    // patient id it liked.
    const session = await this.sessions.findById(sessionId);
    if (!session?.patient_id) {
      throw new DomainError(
        'CONSENT_REQUIRED',
        req.correlationId,
        'no consented patient on this session',
      );
    }

    const { patient, possibleDuplicates } = await this.registration.register(parsed.data, {
      hospitalId: req.kiosk.hospitalId,
      provisionalPatientId: session.patient_id,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    });

    await this.sessions.transition(sessionId, 'IDENTITY_PENDING');
    await this.sessions.transition(sessionId, 'IDENTITY_CONFIRMED', { patient_id: patient.id });

    return { patientId: patient.id, possibleDuplicates };
  }

  private context(req: KioskRequest, sessionId?: string): ResolveContext {
    return {
      hospitalId: req.kiosk.hospitalId,
      kioskDeviceId: req.kiosk.deviceId,
      kioskSessionId: sessionId,
      correlationId: req.correlationId,
      actorId: `kiosk:${req.kiosk.deviceCode}`,
    };
  }
}
