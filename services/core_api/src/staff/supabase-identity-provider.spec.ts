import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { SupabaseStaffIdentityProvider } from './supabase-identity-provider';

const SECRET = 'a-supabase-jwt-secret-long-enough-to-pass';
const URL = 'https://evgxuixekplreqhwszlt.supabase.co';

const config = (overrides: Record<string, unknown> = {}): ConfigService<Env, true> =>
  ({
    get: (key: string) => ({ SUPABASE_JWT_SECRET: SECRET, SUPABASE_URL: URL, ...overrides })[key],
  }) as unknown as ConfigService<Env, true>;

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  claims: Record<string, unknown>,
  { alg = 'HS256', secret = SECRET }: { alg?: string; secret?: string } = {},
): string {
  const head = b64({ alg, typ: 'JWT' });
  const body = b64({
    sub: 'user-uuid',
    aud: 'authenticated',
    iss: `${URL}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

describe('SupabaseStaffIdentityProvider', () => {
  const provider = new SupabaseStaffIdentityProvider(config());

  it('accepts a valid access token', async () => {
    await expect(provider.verify(token({}))).resolves.toEqual({
      subject: 'user-uuid',
      displayName: 'user-uuid',
    });
  });

  it('accepts it with the Bearer prefix', async () => {
    await expect(provider.verify(`Bearer ${token({})}`)).resolves.not.toBeNull();
  });

  it('prefers a real name for display', async () => {
    const assertion = await provider.verify(
      token({ email: 'dr.rao@hospital.example', user_metadata: { full_name: 'Dr Meena Rao' } }),
    );
    expect(assertion?.displayName).toBe('Dr Meena Rao');
  });

  it('rejects a token signed with another secret', async () => {
    await expect(
      provider.verify(token({}, { secret: 'not-the-secret-at-all' })),
    ).resolves.toBeNull();
  });

  it('rejects alg:none', async () => {
    // The classic way a JWT check is talked into verifying nothing.
    const head = b64({ alg: 'none', typ: 'JWT' });
    const body = b64({ sub: 'attacker', aud: 'authenticated', exp: 9_999_999_999 });
    await expect(provider.verify(`${head}.${body}.`)).resolves.toBeNull();
  });

  it('rejects an algorithm it was not expecting', async () => {
    await expect(provider.verify(token({}, { alg: 'RS256' }))).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    // A doctor who left at lunchtime must not still have the worklist open.
    await expect(
      provider.verify(token({ exp: Math.floor(Date.now() / 1000) - 60 })),
    ).resolves.toBeNull();
  });

  it('rejects a token with no expiry at all', async () => {
    await expect(provider.verify(token({ exp: undefined }))).resolves.toBeNull();
  });

  it('rejects a token from another Supabase project', async () => {
    await expect(
      provider.verify(token({ iss: 'https://someone-else.supabase.co/auth/v1' })),
    ).resolves.toBeNull();
  });

  it('rejects a service-role token', async () => {
    // It is signed with the same secret. Its audience is not `authenticated`, and if that
    // were not checked, anything holding the service key could sign in as a clinician.
    await expect(provider.verify(token({ aud: 'service_role' }))).resolves.toBeNull();
  });

  it('rejects malformed input rather than throwing', async () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '...']) {
      await expect(provider.verify(bad)).resolves.toBeNull();
    }
  });

  it('asserts no role — the hospital decides that, not the token', async () => {
    // user_metadata is writable by the user. A role read from it would be self-assigned.
    const assertion = await provider.verify(
      token({ user_metadata: { full_name: 'X', role: 'GOVERNANCE_REVIEWER' } }),
    );
    expect(assertion).not.toBeNull();
    expect(Object.keys(assertion as object)).toEqual(['subject', 'displayName']);
  });

  it('refuses to construct without the secret', () => {
    expect(
      () => new SupabaseStaffIdentityProvider(config({ SUPABASE_JWT_SECRET: undefined })),
    ).toThrow(/SUPABASE_JWT_SECRET/);
  });
});
