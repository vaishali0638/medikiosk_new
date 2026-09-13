import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { IntakeModule } from '../intake/intake.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { FollowUpController } from './followup.controller';
import { FollowUpService } from './followup.service';
import { VerifiedVisitService } from './verified-visit.service';

@Module({
  imports: [ConsentModule, PreCheckinModule, IntakeModule],
  controllers: [FollowUpController],
  providers: [FollowUpService, VerifiedVisitService, AuditRepository, KioskDeviceGuard],
  exports: [FollowUpService, VerifiedVisitService],
})
export class FollowUpModule {}
