import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditRepository } from '../audit/audit.repository';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { SmsAdapter } from '../sms/sms.adapter';
import { buildSmsAdapter } from '../sms/sms.factory';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OtpService } from './otp.service';
import { RegistrationService } from './registration.service';
import type { Env } from '../config/env';

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    OtpService,
    RegistrationService,
    KioskSessionRepository,
    KioskDeviceGuard,
    AuditRepository,
    {
      provide: SmsAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SmsAdapter => buildSmsAdapter(config),
    },
  ],
  exports: [IdentityService, OtpService, RegistrationService],
})
export class IdentityModule {}
