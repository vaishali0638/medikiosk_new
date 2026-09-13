import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HisAdapter, SandboxHisAdapter, UnconfiguredHisAdapter } from '@medikiosk/his-adapter';
import { AuditRepository } from '../audit/audit.repository';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { ArrivalController } from './arrival.controller';
import { ArrivalService } from './arrival.service';
import { QrNonceRepository } from './qr-nonce.repository';
import { TokenRequestRepository } from './token-request.repository';
import { TokenService } from './token.service';
import type { Env } from '../config/env';

@Module({
  imports: [PreCheckinModule],
  controllers: [ArrivalController],
  providers: [
    ArrivalService,
    TokenService,
    {
      provide: HisAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): HisAdapter =>
        config.get('HIS_ADAPTER', { infer: true }) === 'sandbox'
          ? new SandboxHisAdapter()
          : new UnconfiguredHisAdapter(),
    },
    QrNonceRepository,
    TokenRequestRepository,
    KioskSessionRepository,
    KioskDeviceGuard,
    AuditRepository,
  ],
  exports: [ArrivalService, TokenService],
})
export class ArrivalModule {}
