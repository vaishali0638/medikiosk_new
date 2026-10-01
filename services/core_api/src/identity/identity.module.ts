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
import { SupabaseOtpTransport } from './supabase-otp.transport';
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
    {
      // Null unless OTP_PROVIDER=supabase. The transport demands its credentials in the
      // constructor, so building it unconditionally would stop every other deployment
      // from booting over configuration it has no use for.
      provide: SupabaseOtpTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SupabaseOtpTransport | null =>
        config.get('OTP_PROVIDER', { infer: true }) === 'supabase'
          ? new SupabaseOtpTransport(config)
          : null,
    },
  ],
  exports: [IdentityService, OtpService, RegistrationService],
})
export class IdentityModule {}
