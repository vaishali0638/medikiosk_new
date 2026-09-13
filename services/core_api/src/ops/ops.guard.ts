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

    if (!expected) {
      throw new DomainError(
        'INTERNAL_ERROR',
        request.correlationId,
        'OPS_API_KEY is not configured; operations endpoints are disabled',
      );
    }

    const header = request.header('authorization') ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';

    const a = Buffer.from(supplied, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DomainError('VALIDATION_FAILED', request.correlationId, 'bad ops credentials');
    }
    return true;
  }
}
