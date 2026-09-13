import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../common/domain-error';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { StaffAuthService, type StaffContext } from './staff-auth.service';

export interface StaffRequest extends CorrelatedRequest {
  staff: StaffContext;
}

/**
 * Requires a live staff session.
 *
 * Authentication only — it establishes who is asking. Whether they may see a particular
 * patient is a separate decision, made per record by `EncounterAccessService`, because
 * "signed in" and "entitled to this record" are different questions and collapsing them
 * is how a valid login becomes access to the whole hospital.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly auth: StaffAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const header = request.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const staff = await this.auth.resolve(token);
    if (!staff) {
      throw new DomainError('NOT_AUTHENTICATED', request.correlationId, 'no live staff session');
    }

    request.staff = staff;
    return true;
  }
}
