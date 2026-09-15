import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/** AES-256-GCM. The IV and auth tag are stored alongside the ciphertext. */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The envelope every object store writes, whatever it writes it to.
 *
 * Extracted so that adding a new transport — Supabase, S3, anything — cannot accidentally
 * ship a store that forgets to encrypt, or that hashes the ciphertext instead of the
 * original. Those are the two mistakes available here and both are silent: the first
 * hands a storage operator readable prescriptions, the second produces a hash that proves
 * nothing about what the patient uploaded.
 *
 * Encryption is applied by the application rather than left to the storage layer because
 * the object store is frequently operated by a different team, or is a managed service.
 * Server-side encryption protects the disk, not the operator. This means a Supabase or
 * MinIO administrator holds ciphertext.
 */
export class ObjectEncryption {
  private readonly logger = new Logger(ObjectEncryption.name);
  readonly keyId: string;
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.keyId = config.get('OBJECT_ENCRYPTION_KEY_ID', { infer: true }) ?? 'dev';
    const secret = config.get('OBJECT_ENCRYPTION_KEY', { infer: true });

    if (!secret) {
      if (config.get('NODE_ENV', { infer: true }) === 'production') {
        throw new Error('OBJECT_ENCRYPTION_KEY is required in production');
      }
      this.logger.warn(
        'OBJECT_ENCRYPTION_KEY is not set. Using an ephemeral development key — documents ' +
          'stored before a restart will not be readable afterwards.',
      );
      this.key = randomBytes(32);
    } else {
      // scrypt rather than the raw secret: a configured passphrase is rarely 32 bytes of
      // entropy, and stretching it costs nothing at boot.
      this.key = scryptSync(secret, `medikiosk:${this.keyId}`, 32);
    }
  }

  /**
   * Encrypts, and hashes the ORIGINAL.
   *
   * The hash is taken before encryption because it has to prove the bytes the patient
   * uploaded are the bytes the doctor sees, independent of how they were stored — or of
   * whether the storage backend was later migrated.
   */
  seal(plaintext: Buffer): { envelope: Buffer; sha256: string } {
    const sha256 = createHash('sha256').update(plaintext).digest('hex');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { envelope: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), sha256 };
  }

  /** GCM authentication means a tampered object throws rather than returning altered bytes. */
  open(envelope: Buffer): Buffer {
    const iv = envelope.subarray(0, IV_BYTES);
    const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
