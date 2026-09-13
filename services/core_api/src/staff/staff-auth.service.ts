import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { StaffUserRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { StaffIdentityProvider } from './identity-provider';

/** A signed-in member of staff, as every guarded handler sees them. */
export interface StaffContext {
  readonly userId: string;
  readonly hospitalId: string;
  readonly subject: string;
  readonly displayName: string;
  readonly role: StaffUserRow['role'];
  readonly departmentId: string | null;
}

/** Eight hours: a shift. Long enough not to interrupt a clinic, short enough to expire. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly idp: StaffIdentityProvider,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Exchanges an identity-provider credential for a session token.
   *
   * The staff record must already exist. Signing in does not create one: a hospital
   * provisions its clinicians deliberately, and auto-creating an account for any subject
   * the IdP recognises would give every employee in the organisation — porters,
   * accountants — a clinical worklist the moment they authenticated.
   */
  async signIn(
    credential: string,
    correlationId: string,
  ): Promise<{ token: string; expiresAt: Date; staff: StaffContext }> {
    const assertion = await this.idp.verify(credential);
    if (!assertion) {
      throw new DomainError('NOT_AUTHENTICATED', correlationId, 'identity provider rejected');
    }

    const user = await this.db
      .selectFrom('staff_user')
      .selectAll()
      .where('subject', '=', assertion.subject)
      .where('enabled', '=', true)
      .executeTakeFirst();

    if (!user) {
      // Same error as a bad credential. Distinguishing "not a valid login" from "valid
      // login, no account here" tells an outsider who works at this hospital.
      throw new DomainError('NOT_AUTHENTICATED', correlationId, 'no enabled staff record');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    await this.db
      .insertInto('staff_session')
      .values({
        staff_user_id: user.id,
        token_hash: hashToken(token),
        expires_at: expiresAt,
      })
      .execute();

    await this.audit.append({
      actorId: user.id,
      actorRole: user.role,
      action: 'STAFF_SIGNED_IN',
      entityType: 'staff_user',
      entityId: user.id,
      correlationId,
      detail: { provider: this.idp.kind },
    });

    return { token, expiresAt, staff: toContext(user) };
  }

  /** Resolves a bearer token, or null. Touches `last_used_at` so idle sessions are visible. */
  async resolve(token: string): Promise<StaffContext | null> {
    if (token.length === 0) return null;

    const row = await this.db
      .selectFrom('staff_session')
      .innerJoin('staff_user', 'staff_user.id', 'staff_session.staff_user_id')
      .selectAll('staff_user')
      .select(['staff_session.id as sessionId', 'staff_session.token_hash as tokenHash'])
      .where('staff_session.token_hash', '=', hashToken(token))
      .where('staff_session.revoked_at', 'is', null)
      .where('staff_session.expires_at', '>', new Date())
      .where('staff_user.enabled', '=', true)
      .executeTakeFirst();

    if (!row) return null;

    // The lookup is by hash and therefore already exact, but the comparison is done in
    // constant time anyway: the cost is nothing and it keeps the property true if the
    // lookup is ever widened.
    const supplied = Buffer.from(hashToken(token), 'utf8');
    const stored = Buffer.from(row.tokenHash, 'utf8');
    if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;

    await this.db
      .updateTable('staff_session')
      .set({ last_used_at: new Date() })
      .where('id', '=', row.sessionId)
      .execute();

    return toContext(row);
  }

  async signOut(token: string): Promise<void> {
    await this.db
      .updateTable('staff_session')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', hashToken(token))
      .where('revoked_at', 'is', null)
      .execute();
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toContext(row: StaffUserRow): StaffContext {
  return {
    userId: row.id,
    hospitalId: row.hospital_id,
    subject: row.subject,
    displayName: row.display_name,
    role: row.role,
    departmentId: row.department_id,
  };
}
