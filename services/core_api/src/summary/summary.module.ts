import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { DocumentsModule } from '../documents/documents.module';
import { KioskModule } from '../kiosk/kiosk.module';
import { IntakeModule } from '../intake/intake.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { DRAFT_GENERATOR, TimeBoundedGenerator, type DraftGenerator } from './generator.adapter';
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
      useFactory: (config: ConfigService<Env, true>): DraftGenerator | null => {
        // With the flag off — the default — there is no generator at all, and the
        // deterministic composer is what every clinician reads.
        if (!config.get('FEATURE_AI_SUMMARY', { infer: true })) return null;

        // AI_WORKER_URL unset means the generator composes in-process. It is passed here
        // rather than read inside the generator so that "is a worker configured" is a
        // decision made once, at wiring time, where it can be seen.
        const timeoutMs = config.get('AI_WORKER_TIMEOUT_MS', { infer: true });
        const generator = new ModelDraftGenerator(
          config.get('AI_WORKER_URL', { infer: true }),
          timeoutMs,
        );

        // The generator bounds its own HTTP call; this bounds the generator. The two are
        // not redundant — a hung DNS lookup or a slow local composition is outside the
        // fetch, and the deterministic fallback is only reached if something gives up.
        return new TimeBoundedGenerator(generator, timeoutMs * 2);
      },
    },
  ],
  exports: [SummaryService, SubmissionService, ReviewService],
})
export class SummaryModule {}
