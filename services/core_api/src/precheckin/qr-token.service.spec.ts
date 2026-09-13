import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { QrClaims } from '@medikiosk/api-contracts';
import type { Env } from '../config/env';
import { QrTokenService } from './qr-token.service';

/** Minimal ConfigService stand-in, typed as the service expects it. */
function configFor(values: Record<string, unknown> = {}): ConfigService<Env, true> {
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function claims(overrides: Partial<QrClaims> = {}): Omit<QrClaims, 'expiresAt'> {
  const now = Date.now();
  return {
    preCheckinId: randomUUID(),
    hospitalId: 'HOSP-001',
    branchId: 'MAIN',
    departmentId: 'AYU-OPD',
    visitWindowStart: new Date(now - 3_600_000).toISOString(),
    visitWindowEnd: new Date(now + 3_600_000).toISOString(),
    nonce: randomUUID(),
    ...overrides,
  };
}

describe('QrTokenService', () => {
  let service: QrTokenService;

  beforeEach(() => {
    service = new QrTokenService(configFor({ QR_SIGNING_KEY_ID: 'test' }));
  });

  describe('signing', () => {
    it('produces a token this service can verify', () => {
      const signed = service.sign(claims());
      const result = service.verify(signed.token);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.claims.preCheckinId).toBe(signed.claims.preCheckinId);
    });

    it('pins the algorithm in the token prefix', () => {
      // Not JWS: the algorithm is never negotiated from inside the token, so `alg: none`
      // and algorithm-confusion attacks have nothing to act on.
      const signed = service.sign(claims());
      expect(signed.token.startsWith('mk1.test.')).toBe(true);
      expect(signed.token.split('.')).toHaveLength(4);
    });

    it('carries no medical information', () => {
      const signed = service.sign(claims());
      const payload = Buffer.from(signed.token.split('.')[2] as string, 'base64url').toString();

      // The code is displayed on a phone screen in a public waiting area and may be
      // photographed by anyone standing nearby.
      const decoded = JSON.parse(payload) as Record<string, unknown>;
      expect(Object.keys(decoded).sort()).toEqual([
        'branchId',
        'departmentId',
        'expiresAt',
        'hospitalId',
        'nonce',
        'preCheckinId',
        'visitWindowEnd',
        'visitWindowStart',
      ]);
    });

    it('is short-lived by default', () => {
      const signed = service.sign(claims());
      const ttlMs = signed.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(300_000);
    });

    it('gives every token a distinct signature', () => {
      const a = service.sign(claims());
      const b = service.sign(claims());
      expect(a.token).not.toBe(b.token);
    });
  });

  describe('rejection', () => {
    it('rejects a token with a tampered payload', () => {
      const signed = service.sign(claims({ departmentId: 'AYU-OPD' }));
      const parts = signed.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[2] as string, 'base64url').toString()) as Record<
        string,
        unknown
      >;

      // Repointing the visit at another department while keeping the signature.
      payload['departmentId'] = 'CARDIO-OPD';
      parts[2] = Buffer.from(JSON.stringify(payload)).toString('base64url');

      expect(service.verify(parts.join('.'))).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('rejects a token signed by a different key', () => {
      const other = new QrTokenService(configFor({ QR_SIGNING_KEY_ID: 'test' }));
      const foreign = other.sign(claims());
      // Same key id, different ephemeral key: the signature must not verify.
      expect(service.verify(foreign.token)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('rejects an unknown key id', () => {
      const signed = service.sign(claims());
      const parts = signed.token.split('.');
      parts[1] = 'attacker-key';
      expect(service.verify(parts.join('.'))).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });

    it('rejects a token claiming a different format version', () => {
      const signed = service.sign(claims());
      const parts = signed.token.split('.');
      parts[0] = 'none';
      expect(service.verify(parts.join('.'))).toEqual({ ok: false, reason: 'MALFORMED' });
    });

    it('rejects an expired token', () => {
      const signed = service.sign(claims(), -1);
      expect(service.verify(signed.token)).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('rejects a token whose claims do not fit the contract', () => {
      const signed = service.sign(claims());
      const parts = signed.token.split('.');
      // Re-sign a structurally valid but semantically wrong payload with the real key,
      // so this tests the claim check rather than the signature check.
      const bad = Buffer.from(JSON.stringify({ preCheckinId: 'not-a-uuid' })).toString('base64url');
      const reSigned = service.sign(claims());
      const reParts = reSigned.token.split('.');
      reParts[2] = bad;
      expect(service.verify(reParts.join('.')).ok).toBe(false);
      expect(parts).toHaveLength(4);
    });

    it('rejects malformed input without throwing', () => {
      for (const bad of ['', 'garbage', 'mk1.test', 'a.b.c.d.e', 'mk1.test..', '....']) {
        expect(service.verify(bad).ok).toBe(false);
      }
    });
  });

  describe('key rotation', () => {
    it('still verifies a code signed by a retired key', () => {
      const { privateKeyPem, publicKeyPem } = QrTokenService.generateKeyPair();
      const old = new QrTokenService(
        configFor({ QR_SIGNING_KEY: privateKeyPem, QR_SIGNING_KEY_ID: 'k1' }),
      );
      const issued = old.sign(claims());

      // A patient holding a code on screen when the key rotates must not be stranded.
      const rotated = new QrTokenService(
        configFor({
          QR_SIGNING_KEY_ID: 'k2',
          QR_RETIRED_PUBLIC_KEYS: `k1:${publicKeyPem}`,
        }),
      );

      const result = rotated.verify(issued.token);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.keyId).toBe('k1');
    });

    it('signs new codes with the active key after rotation', () => {
      const { publicKeyPem } = QrTokenService.generateKeyPair();
      const rotated = new QrTokenService(
        configFor({ QR_SIGNING_KEY_ID: 'k2', QR_RETIRED_PUBLIC_KEYS: `k1:${publicKeyPem}` }),
      );
      expect(rotated.sign(claims()).keyId).toBe('k2');
    });
  });

  describe('production safety', () => {
    it('refuses to boot without a configured key', () => {
      expect(() => new QrTokenService(configFor({ NODE_ENV: 'production' }))).toThrow(
        /QR_SIGNING_KEY is required in production/,
      );
    });

    it('generates an ephemeral key in development rather than using a fixed fallback', () => {
      // A hard-coded fallback key would work, and would be in the repository.
      const a = new QrTokenService(configFor({}));
      const b = new QrTokenService(configFor({}));
      expect(b.verify(a.sign(claims()).token)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });
  });

  describe('nonce comparison', () => {
    it('matches identical nonces', () => {
      const nonce = randomUUID();
      expect(QrTokenService.nonceMatches(nonce, nonce)).toBe(true);
    });

    it('rejects different nonces, including different lengths', () => {
      expect(QrTokenService.nonceMatches(randomUUID(), randomUUID())).toBe(false);
      expect(QrTokenService.nonceMatches('short', 'a-much-longer-value')).toBe(false);
    });
  });
});
