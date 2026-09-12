import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditRepository } from './audit/audit.repository';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { QrNonceRepository } from './arrival/qr-nonce.repository';
import { TokenRequestRepository } from './arrival/token-request.repository';
import { DbModule } from './db/db.module';
import { ConsentModule } from './consent/consent.module';
import { IdentityModule } from './identity/identity.module';
import { KioskModule } from './kiosk/kiosk.module';
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
    KioskModule,
    ConsentModule,
    IdentityModule,
  ],
  // Arrival repositories still live here; their controllers arrive in Phases 6 and 7.
  providers: [AuditRepository, QrNonceRepository, TokenRequestRepository],
  exports: [AuditRepository, QrNonceRepository, TokenRequestRepository],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
