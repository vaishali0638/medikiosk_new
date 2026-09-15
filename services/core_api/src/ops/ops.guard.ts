import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common/domain-error';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import type { Env } from '../config/env';

/**
 * Guards the operations endpoints with a shared key.
 *
 * A PLACEHOLDER, and marked as one. Phase 15 replaces it with hospital staff SSO and
 * per-role authorisation. A shared bearer token cannot say who acted, which is exactly
 * what an audit trail needs — so nothing behind this guard may read or alter clinical
 * data. It exposes queue plumbing: which token requests are stuck, and nothing about
 * the patients attached to them.
 *
 * Refuses to activate at all when no key is configured, rather than defaulting open.
 */
@Injectable()
export class OpsGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CorrelatedRequest>();
    const expected = this.config.get('OPS_API_KEY', { infer: true });

    // 401, not 500. Refusing is right — these endpoints must never default open — but an
    // unset key is a configuration state, not a server fault, and calling it INTERNAL_ERROR
    // had two costs. Prometheus scrapes /v1/metrics: a 500 there reads as the API being
    // down, which is an alerting false positive in the one component whose job is to notice
    // outages. And it told an unauthenticated caller that the ops API is unconfigured,
    // which is not their business.
    if (!expected) {
      throw new DomainError(
        'NOT_AUTHENTICATED',
        request.correlationId,
        'OPS_API_KEY is not configured; operations endpoints are disabled',
      );
    }

    const header = request.header('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';

    const a = Buffer.from(supplied, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    // Same code and status as the unconfigured case above, so a caller cannot tell a wrong
    // key from an absent one. VALIDATION_FAILED was also simply the wrong word: nothing
    // about the request was malformed.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DomainError('NOT_AUTHENTICATED', request.correlationId, 'bad ops credentials');
    }
    return true;
  }
}
