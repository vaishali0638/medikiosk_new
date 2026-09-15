import { resolve } from 'node:path';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditRepository } from './audit/audit.repository';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { QrNonceRepository } from './arrival/qr-nonce.repository';
import { TokenRequestRepository } from './arrival/token-request.repository';
import { DbModule } from './db/db.module';
import { ConsentModule } from './consent/consent.module';
import { ArrivalModule } from './arrival/arrival.module';
import { IdentityModule } from './identity/identity.module';
import { DocumentsModule } from './documents/documents.module';
import { SummaryModule } from './summary/summary.module';
import { FollowUpModule } from './followup/followup.module';
import { StaffModule } from './staff/staff.module';
import { GovernanceModule } from './governance/governance.module';
import { SecurityModule } from './security/security.module';
import { ObservabilityModule } from './observability/observability.module';
import { IntakeModule } from './intake/intake.module';
import { OpsModule } from './ops/ops.module';
import { PatientChannelModule } from './patient-channel/patient-channel.module';
import { PreCheckinModule } from './precheckin/precheckin.module';
import { KioskModule } from './kiosk/kiosk.module';
import { loadEnv } from './config/env';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Both locations, because the API is started from either. `npm run start:dev -w
      // @medikiosk/core-api` runs with the service as the working directory, so a .env at
      // the repository root — which is where everything else expects it, and where the
      // Supabase runbook puts it — was silently not read. The failure is a server that
      // starts against the wrong database and says nothing.
      envFilePath: ['.env', resolve(__dirname, '../../../.env')],
      // ...but never during tests. The suite sets what it needs explicitly in
      // test/setup-integration.ts, and a developer's .env reaching it makes the results
      // depend on a file that is not in the repository: the first symptom here was
      // fourteen identity tests failing on a machine where someone had configured a real
      // OTP secret, and passing everywhere else.
      ignoreEnvFile: process.env['NODE_ENV'] === 'test',
      // Fail fast on a bad environment rather than surfacing it mid-journey.
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
    DbModule,
    HealthModule,
    KioskModule,
    ConsentModule,
    IdentityModule,
    PreCheckinModule,
    ArrivalModule,
    PatientChannelModule,
    OpsModule,
    IntakeModule,
    DocumentsModule,
    SummaryModule,
    FollowUpModule,
    StaffModule,
    GovernanceModule,
    SecurityModule,
    ObservabilityModule,
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
