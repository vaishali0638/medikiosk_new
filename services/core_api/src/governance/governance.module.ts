import { Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { StaffModule } from '../staff/staff.module';
import { GovernanceController } from './governance.controller';
import { GovernanceQueryService } from './governance-query.service';
import { ReleaseService } from './release.service';

@Module({
  imports: [StaffModule],
  controllers: [GovernanceController],
  providers: [ReleaseService, GovernanceQueryService, AuditRepository],
  exports: [ReleaseService],
})
export class GovernanceModule {}
