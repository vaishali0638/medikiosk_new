import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { qrClaimsSchema, type QrClaims } from '@medikiosk/api-contracts';
import type { Env } from '../config/env';

/**
 * Token format: `mk1.<keyId>.<payload>.<signature>`, all base64url.
 *
 * Deliberately NOT JWS. JWS carries the algorithm inside the token's own header, which is
 * the source of the `alg: none` and RS256-to-HS256 confusion attacks — the verifier ends
 * up asking the attacker how to check the attacker's signature. Here `mk1` pins Ed25519
 * for the whole format; a token that does not start with it is rejected before anything
 * else is read. Changing algorithm means a new prefix and an explicit code change.
 */
const TOKEN_PREFIX = 'mk1';

/** A QR is scanned within minutes of being shown. Long-lived codes are stolen codes. */
const DEFAULT_TTL_SECONDS = 300;

export interface SignedQr {
  readonly token: string;
  readonly claims: QrClaims;
  readonly expiresAt: Date;
  readonly keyId: string;
}

export type QrVerifyFailure =
  'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'EXPIRED' | 'BAD_CLAIMS';

export type QrVerifyResult =
  | { readonly ok: true; readonly claims: QrClaims; readonly keyId: string }
  | { readonly ok: false; readonly reason: QrVerifyFailure };

const b64url = (buf: Buffer): string => buf.toString('base64url');
const fromB64url = (value: string): Buffer => Buffer.from(value, 'base64url');

@Injectable()
export class QrTokenService {
  private readonly logger = new Logger(QrTokenService.name);
  private readonly privateKey: KeyObject;
  private readonly publicKeys: Map<string, KeyObject>;
  private readonly activeKeyId: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const configured = this.config.get('QR_SIGNING_KEY', { infer: true });
    this.activeKeyId = this.config.get('QR_SIGNING_KEY_ID', { infer: true }) ?? 'dev';

    if (configured) {
      this.privateKey = createPrivateKey(configured);
    } else {
      if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
        throw new Error('QR_SIGNING_KEY is required in production');
      }
      // An ephemeral key means codes issued before a restart stop verifying — which is
      // the right failure for development, because it is loud. A hard-coded fallback key
      // would be worse: it would work, and it would be in the repository.
      const pair = generateKeyPairSync('ed25519');
      this.privateKey = pair.privateKey;
      this.logger.warn(
        'QR_SIGNING_KEY is not set. Generated an ephemeral development key — codes issued ' +
          'before a restart will stop verifying.',
      );
    }

    this.publicKeys = new Map([[this.activeKeyId, createPublicKey(this.privateKey)]]);

    // Previous public keys stay verifiable so a rotation does not invalidate codes that
    // are already on a patient's screen. Format: `<keyId>:<pem>` entries, newline-separated.
    const retired = this.config.get('QR_RETIRED_PUBLIC_KEYS', { infer: true });
    if (retired) {
      for (const entry of retired.split('\n\n')) {
        const separator = entry.indexOf(':');
        if (separator <= 0) continue;
        const keyId = entry.slice(0, separator).trim();
        const pem = entry.slice(separator + 1).trim();
        if (keyId && pem) this.publicKeys.set(keyId, createPublicKey(pem));
      }
    }
  }

  sign(claims: Omit<QrClaims, 'expiresAt'>, ttlSeconds = DEFAULT_TTL_SECONDS): SignedQr {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const full: QrClaims = { ...claims, expiresAt: expiresAt.toISOString() };

    const payload = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
    const signingInput = `${TOKEN_PREFIX}.${this.activeKeyId}.${payload}`;
    const signature = b64url(cryptoSign(null, Buffer.from(signingInput, 'utf8'), this.privateKey));

    return {
      token: `${signingInput}.${signature}`,
      claims: full,
      expiresAt,
      keyId: this.activeKeyId,
    };
  }

  /**
   * Verifies a scanned token.
   *
   * Order matters: format, then key, then signature, then expiry, then claim shape. The
   * signature is checked before anything in the payload is trusted, so a forged token
   * cannot steer the verifier through its own contents.
   */
  verify(token: string): QrVerifyResult {
    const parts = token.split('.');
    if (parts.length !== 4) return { ok: false, reason: 'MALFORMED' };

    const [prefix, keyId, payload, signature] = parts as [string, string, string, string];
    if (prefix !== TOKEN_PREFIX) return { ok: false, reason: 'MALFORMED' };

    const publicKey = this.publicKeys.get(keyId);
    if (!publicKey) return { ok: false, reason: 'UNKNOWN_KEY' };

    const signingInput = Buffer.from(`${prefix}.${keyId}.${payload}`, 'utf8');
    let signatureBytes: Buffer;
    try {
      signatureBytes = fromB64url(signature);
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }

    if (!cryptoVerify(null, signingInput, publicKey, signatureBytes)) {
      return { ok: false, reason: 'BAD_SIGNATURE' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fromB64url(payload).toString('utf8'));
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }

    const claims = qrClaimsSchema.safeParse(parsed);
    if (!claims.success) return { ok: false, reason: 'BAD_CLAIMS' };

    if (new Date(claims.data.expiresAt).getTime() <= Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    return { ok: true, claims: claims.data, keyId };
  }

  /**
   * Compares two nonces in constant time.
   *
   * The nonce in a verified token is matched against the stored one; a length-and-content
   * comparison that short-circuits would leak it a character at a time to anyone able to
   * measure the response.
   */
  static nonceMatches(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  /** Generates a keypair for `QR_SIGNING_KEY`. Used by the ops runbook, not at runtime. */
  static generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
    const pair = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  }
}
