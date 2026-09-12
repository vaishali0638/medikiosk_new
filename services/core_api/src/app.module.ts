import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditRepository } from './audit/audit.repository';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { ConsentRepository } from './consent/consent.repository';
import { QrNonceRepository } from './arrival/qr-nonce.repository';
import { TokenRequestRepository } from './arrival/token-request.repository';
import { DbModule } from './db/db.module';
import { loadEnv } from './config/env';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Fail fast on a bad environment rather than surfacing it mid-journey.
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
    DbModule,
    HealthModule,
  ],
  // Phase 2 exposes the repositories only; the controllers that use them arrive with
  // their own phases (consent in 4, arrival in 6, tokens in 7).
  providers: [AuditRepository, ConsentRepository, QrNonceRepository, TokenRequestRepository],
  exports: [AuditRepository, ConsentRepository, QrNonceRepository, TokenRequestRepository],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
