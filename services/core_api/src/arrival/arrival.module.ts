import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { ArrivalController } from './arrival.controller';
import { ArrivalService } from './arrival.service';
import { QrNonceRepository } from './qr-nonce.repository';
import { TokenRequestRepository } from './token-request.repository';

@Module({
  imports: [PreCheckinModule],
  controllers: [ArrivalController],
  providers: [
    ArrivalService,
    QrNonceRepository,
    TokenRequestRepository,
    KioskSessionRepository,
    KioskDeviceGuard,
    AuditRepository,
  ],
  exports: [ArrivalService],
})
export class ArrivalModule {}
