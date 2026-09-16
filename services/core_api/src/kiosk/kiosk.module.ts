import { VerifiedVisitService } from '../followup/verified-visit.service';
import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentNoticeService } from '../consent/consent-notice.service';
import { KioskConfigService } from './kiosk-config.service';
import { KioskController } from './kiosk.controller';
import { KioskDeviceGuard } from './kiosk-device.guard';
import { KioskSessionRepository } from './kiosk-session.repository';
import { KioskVisitService } from './kiosk-visit.service';
import { ConsentModule } from '../consent/consent.module';

@Module({
  imports: [ConsentModule],
  controllers: [KioskController],
  providers: [
    VerifiedVisitService,
    KioskConfigService,
    ConsentNoticeService,
    KioskSessionRepository,
    KioskDeviceGuard,
    KioskVisitService,
    AuditRepository,
  ],
  exports: [KioskConfigService, KioskSessionRepository, KioskVisitService],
})
export class KioskModule {}
