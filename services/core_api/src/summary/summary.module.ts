import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { DocumentsModule } from '../documents/documents.module';
import { IntakeModule } from '../intake/intake.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { DRAFT_GENERATOR, UnavailableGenerator, type DraftGenerator } from './generator.adapter';
import { ReviewService } from './review.service';
import { SubmissionService } from './submission.service';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import type { Env } from '../config/env';

@Module({
  imports: [ConsentModule, PreCheckinModule, IntakeModule, DocumentsModule],
  controllers: [SummaryController],
  providers: [
    ReviewService,
    SummaryService,
    SubmissionService,
    AuditRepository,
    KioskDeviceGuard,
    {
      provide: DRAFT_GENERATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DraftGenerator | null =>
        // With the flag off — the default — there is no generator at all, and the
        // deterministic composer is what every clinician reads. No model ships in this
        // repository, so the flag being on currently means the same thing; it exists so
        // that wiring one in is a configuration change and not a code change.
        config.get('FEATURE_AI_SUMMARY', { infer: true }) ? new UnavailableGenerator() : null,
    },
  ],
  exports: [SummaryService, SubmissionService, ReviewService],
})
export class SummaryModule {}
