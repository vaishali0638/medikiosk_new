import { Global, Module } from '@nestjs/common';
import { AuditRepository } from '../audit/audit.repository';
import { RateLimitService } from './rate-limit.service';
import { RetentionService } from './retention.service';

/**
 * Global, because rate limiting is applied at the handlers that need it rather than by a
 * middleware over everything. A blanket limiter would either be too loose to matter or
 * would throttle a kiosk polling its own session state.
 */
@Global()
@Module({
  providers: [RateLimitService, RetentionService, AuditRepository],
  exports: [RateLimitService, RetentionService],
})
export class SecurityModule {}
