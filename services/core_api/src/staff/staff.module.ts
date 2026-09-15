import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmrExportAdapter,
  SandboxEmrExportAdapter,
  UnconfiguredEmrExportAdapter,
} from '@medikiosk/his-adapter';
import { AuditRepository } from '../audit/audit.repository';
import { DocumentsModule } from '../documents/documents.module';
import { FollowUpModule } from '../followup/followup.module';
import { SummaryModule } from '../summary/summary.module';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';
import { DocumentLinkService } from './document-link.service';
import { EncounterAccessService } from './encounter-access.service';
import { ExportService } from './export.service';
import {
  SandboxStaffIdentityProvider,
  StaffIdentityProvider,
  UnconfiguredStaffIdentityProvider,
} from './identity-provider';
import { SupabaseStaffIdentityProvider } from './supabase-identity-provider';
import { WorklistEventsService } from './worklist-events.service';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import type { Env } from '../config/env';

@Module({
  imports: [DocumentsModule, SummaryModule, FollowUpModule],
  controllers: [DoctorController],
  providers: [
    StaffAuthService,
    StaffAuthGuard,
    WorklistEventsService,
    DoctorService,
    EncounterAccessService,
    DocumentLinkService,
    ExportService,
    AuditRepository,
    {
      provide: StaffIdentityProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): StaffIdentityProvider => {
        switch (config.get('STAFF_IDP', { infer: true })) {
          case 'sandbox':
            return new SandboxStaffIdentityProvider(config);
          case 'supabase':
            return new SupabaseStaffIdentityProvider(config);
          default:
            // Anything other than an explicitly configured provider means nobody signs in.
            // A clinical dashboard that fails open serves patient records to strangers.
            return new UnconfiguredStaffIdentityProvider();
        }
      },
    },
    {
      provide: EmrExportAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmrExportAdapter =>
        config.get('EMR_EXPORT_ADAPTER', { infer: true }) === 'sandbox'
          ? new SandboxEmrExportAdapter()
          : new UnconfiguredEmrExportAdapter(),
    },
  ],
  exports: [StaffAuthService, EncounterAccessService, StaffAuthGuard],
})
export class StaffModule {}
