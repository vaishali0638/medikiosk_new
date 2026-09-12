import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentNoticeService } from '../consent/consent-notice.service';
import { KioskConfigService } from './kiosk-config.service';
import { KioskController } from './kiosk.controller';
import { KioskDeviceGuard } from './kiosk-device.guard';
import { KioskSessionRepository } from './kiosk-session.repository';

@Module({
  controllers: [KioskController],
  providers: [
    KioskConfigService,
    ConsentNoticeService,
    KioskSessionRepository,
    KioskDeviceGuard,
    AuditRepository,
  ],
  exports: [KioskConfigService, KioskSessionRepository],
})
export class KioskModule {}
