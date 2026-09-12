import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { KioskSessionRepository } from '../kiosk/kiosk-session.repository';
import { ConsentController } from './consent.controller';
import { ConsentNoticeService } from './consent-notice.service';
import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';

@Module({
  controllers: [ConsentController],
  providers: [
    ConsentService,
    ConsentNoticeService,
    ConsentRepository,
    KioskSessionRepository,
    KioskDeviceGuard,
    AuditRepository,
  ],
  exports: [ConsentService, ConsentNoticeService, ConsentRepository],
})
export class ConsentModule {}
