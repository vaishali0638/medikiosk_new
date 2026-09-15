import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { StaffIdentityProvider, type StaffAssertion } from './identity-provider';

/** The claims MediKiosk reads. Everything else in a Supabase JWT is ignored. */
interface SupabaseClaims {
  readonly sub?: string;
  readonly exp?: number;
  readonly aud?: string | string[];
  readonly iss?: string;
  readonly email?: string;
  readonly user_metadata?: { full_name?: string; name?: string };
}

/**
 * Staff sign-in against Supabase Auth.
 *
 * The hospital's own directory remains the right answer, and `STAFF_IDP=oidc` is where
 * that goes. This exists because an MVP needs real accounts today: Supabase Auth gives
 * email sign-in, invitations and deprovisioning without MediKiosk ever holding a password,
 * which is the property that matters — a clinical system with its own credential store is
 * a second thing to remember when somebody leaves.
 *
 * WHAT THIS DOES NOT DO: it does not read a role from the token. Supabase decides WHO
 * someone is; `staff_user` decides what they may see. A doctor's department scoping and a
 * governance reviewer's authority are clinical-governance decisions the hospital records
 * here, not claims an identity provider can assert — and `user_metadata` in particular is
 * writable by the user themselves, so a role read from it would be self-assigned.
 *
 * Verification is local HS256 against the project's JWT secret. Supabase signs access
 * tokens with it, so there is no network call on the sign-in path: a hospital network with
 * a flaky uplink should not be able to lock a doctor out of the worklist.
 */
@Injectable()
export class SupabaseStaffIdentityProvider extends StaffIdentityProvider {
  readonly kind = 'supabase';
  private readonly logger = new Logger(SupabaseStaffIdentityProvider.name);
  private readonly secret: Buffer;
  private readonly issuer: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    super();
    const secret = config.get('SUPABASE_JWT_SECRET', { infer: true });
    if (!secret) {
      throw new Error('SUPABASE_JWT_SECRET is required when STAFF_IDP=supabase');
    }
    this.secret = Buffer.from(secret, 'utf8');

    const url = config.get('SUPABASE_URL', { infer: true });
    this.issuer = url ? `${url.replace(/\/$/, '')}/auth/v1` : undefined;
    if (!this.issuer) {
      this.logger.warn(
        'SUPABASE_URL is not set, so the token issuer cannot be checked. A token from ' +
          'another Supabase project signed with the same secret would be accepted.',
      );
    }
  }

  async verify(credential: string): Promise<StaffAssertion | null> {
    const token = credential.startsWith('Bearer ') ? credential.slice(7).trim() : credential.trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts as [string, string, string];

    if (!this.signatureMatches(`${header}.${payload}`, signature)) return null;
    if (!this.algorithmIsHs256(header)) return null;

    const claims = this.decode<SupabaseClaims>(payload);
    if (!claims?.sub) return null;

    // Expiry is checked here and not left to a library: an expired token that still opens
    // a worklist is the difference between a doctor who left at lunchtime having access
    // until the process restarts, and not.
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;

    if (this.issuer && claims.iss !== this.issuer) return null;

    // `authenticated` is what Supabase puts in `aud` for a signed-in user. A service-role
    // token has a different audience and must not be able to sign in as a clinician.
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes('authenticated')) return null;

    return {
      subject: claims.sub,
      // For display only. Never used to decide what anyone may see.
      displayName:
        claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? claims.email ?? claims.sub,
    };
  }

  private algorithmIsHs256(header: string): boolean {
    const decoded = this.decode<{ alg?: string }>(header);
    // Pinned. `alg: none`, and HS256-vs-RS256 confusion, are the two classic ways a JWT
    // check is talked into verifying nothing.
    return decoded?.alg === 'HS256';
  }

  private signatureMatches(signingInput: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(signingInput).digest();
    const actual = Buffer.from(signature, 'base64url');
    // Length check first: timingSafeEqual throws on a mismatch rather than returning false.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private decode<T>(segment: string): T | null {
    try {
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
    } catch {
      return null;
    }
  }
}
