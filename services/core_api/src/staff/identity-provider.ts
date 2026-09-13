import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/** What the hospital's identity provider asserts about a person who signed in. */
export interface StaffAssertion {
  /** The IdP's subject claim. The stable join between their account and ours. */
  readonly subject: string;
  readonly displayName: string;
}

/**
 * Verifies a staff sign-in against the hospital's identity provider.
 *
 * MediKiosk never holds a staff password and cannot authenticate one. Hospitals run their
 * own directory, and a clinical system that kept a parallel set of credentials would be a
 * second thing to deprovision when someone leaves — which is the failure that leaves a
 * former employee holding access to patient records.
 */
export abstract class StaffIdentityProvider {
  abstract readonly kind: string;
  /** Returns the assertion, or null when the credential is not valid. */
  abstract verify(credential: string): Promise<StaffAssertion | null>;
}

/**
 * Development sign-in. Accepts `sandbox:<subject>` and asserts that subject.
 *
 * Refuses to construct when `NODE_ENV` is production, rather than refusing at call time.
 * A deployment that reached production with this wired in would otherwise look healthy
 * until the first person typed a colon into a username, and by then it is serving patient
 * records to anyone who guesses a subject.
 */
@Injectable()
export class SandboxStaffIdentityProvider extends StaffIdentityProvider {
  readonly kind = 'sandbox';
  private readonly logger = new Logger(SandboxStaffIdentityProvider.name);

  constructor(config: ConfigService<Env, true>) {
    super();
    if (config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'the sandbox staff identity provider must never run in production; ' +
          'configure STAFF_IDP=oidc with the hospital identity provider',
      );
    }
    this.logger.warn(
      'SANDBOX staff sign-in is enabled. Any subject may sign in. Never use in production.',
    );
  }

  async verify(credential: string): Promise<StaffAssertion | null> {
    if (!credential.startsWith('sandbox:')) return null;
    const subject = credential.slice('sandbox:'.length).trim();
    if (subject.length === 0) return null;
    return { subject, displayName: subject };
  }
}

/** The default when no provider is configured: nobody can sign in. */
@Injectable()
export class UnconfiguredStaffIdentityProvider extends StaffIdentityProvider {
  readonly kind = 'unconfigured';

  async verify(): Promise<StaffAssertion | null> {
    // Fails closed. A clinical dashboard with no configured identity provider must serve
    // nobody, not everybody.
    return null;
  }
}
