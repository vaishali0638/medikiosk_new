import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { DocumentsModule } from '../documents/documents.module';
import { KioskModule } from '../kiosk/kiosk.module';
import { IntakeModule } from '../intake/intake.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { DRAFT_GENERATOR, type DraftGenerator } from './generator.adapter';
import { ModelDraftGenerator } from './model-generator.adapter';
import { ReviewService } from './review.service';
import { SubmissionService } from './submission.service';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import type { Env } from '../config/env';

@Module({
  imports: [ConsentModule, PreCheckinModule, IntakeModule, DocumentsModule, KioskModule],
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
        config.get('FEATURE_AI_SUMMARY', { infer: true }) ? new ModelDraftGenerator() : null,
    },
  ],
  exports: [SummaryService, SubmissionService, ReviewService],
})
export class SummaryModule {}
