import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentModule } from '../consent/consent.module';
import { KioskDeviceGuard } from '../kiosk/kiosk-device.guard';
import { PreCheckinModule } from '../precheckin/precheckin.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { ExtractionService } from './extraction.service';
import {
  HeuristicMalwareScanner,
  MalwareScanner,
  UnconfiguredMalwareScanner,
} from './file-validation';
import { OcrAdapter, UnavailableOcrAdapter } from './ocr.adapter';
import { LocalEncryptedObjectStore, ObjectStore, UnconfiguredObjectStore } from './object-store';
import { SupabaseObjectStore } from './supabase-object-store';
import type { Env } from '../config/env';

@Module({
  imports: [ConsentModule, PreCheckinModule],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    ExtractionService,
    AuditRepository,
    KioskDeviceGuard,
    {
      provide: ObjectStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ObjectStore => {
        switch (config.get('OBJECT_STORE_ADAPTER', { infer: true })) {
          case 'local':
            return new LocalEncryptedObjectStore(config);
          case 'supabase':
            return new SupabaseObjectStore(config);
          default:
            // Throws on use rather than degrading to local disk: a deployment that thinks
            // it is writing to durable storage and is actually writing to a container
            // filesystem loses every document on the next restart, silently.
            return new UnconfiguredObjectStore();
        }
      },
    },
    {
      provide: MalwareScanner,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MalwareScanner =>
        // Anything other than an explicitly configured scanner fails closed.
        config.get('MALWARE_SCANNER', { infer: true }) === 'heuristic'
          ? new HeuristicMalwareScanner()
          : new UnconfiguredMalwareScanner(),
    },
    { provide: OcrAdapter, useClass: UnavailableOcrAdapter },
  ],
  exports: [DocumentService, ExtractionService],
})
export class DocumentsModule {}
