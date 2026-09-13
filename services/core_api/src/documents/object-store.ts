import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export interface StoredObject {
  readonly objectKey: string;
  /** SHA-256 of the ORIGINAL plaintext, computed before encryption. */
  readonly sha256: string;
  readonly byteSize: number;
  readonly encryptionKeyId: string;
}

/**
 * Encrypted object storage for original medical documents.
 *
 * Encryption is applied by the application, not left to the storage layer. In a hospital
 * deployment the object store is frequently operated by a different team, or is a managed
 * service; server-side encryption protects the disk but not the operator. Encrypting here
 * means a MinIO administrator holds ciphertext.
 *
 * The originals are immutable. There is no update operation, only put and get — the
 * specification requires that an original is never silently modified, and the simplest
 * way to guarantee that is to give the code no way to do it.
 */
export abstract class ObjectStore {
  abstract readonly kind: string;
  abstract put(key: string, plaintext: Buffer): Promise<StoredObject>;
  abstract get(key: string): Promise<Buffer>;
  /** Only for a document that failed validation and was never made available. */
  abstract deleteRejected(key: string): Promise<void>;
}

/** AES-256-GCM. The IV and auth tag are stored alongside the ciphertext. */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class LocalEncryptedObjectStore extends ObjectStore {
  readonly kind = 'local-encrypted';
  private readonly logger = new Logger(LocalEncryptedObjectStore.name);
  private readonly root: string;
  private readonly keyId: string;
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.root = resolve(
      config.get('OBJECT_STORE_LOCAL_ROOT', { infer: true }) ?? './.data/objects',
    );
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

  async put(key: string, plaintext: Buffer): Promise<StoredObject> {
    // Hash the ORIGINAL, before encryption. The hash has to prove the bytes the patient
    // uploaded are the bytes the doctor sees, independent of how they were stored.
    const sha256 = createHash('sha256').update(plaintext).digest('hex');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.concat([iv, tag, ciphertext]), { flag: 'wx' });

    return { objectKey: key, sha256, byteSize: plaintext.byteLength, encryptionKeyId: this.keyId };
  }

  async get(key: string): Promise<Buffer> {
    const raw = await readFile(this.pathFor(key));
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    // GCM authentication means a tampered file throws rather than returning altered
    // bytes — which is exactly what "never silently modified" has to mean in practice.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async deleteRejected(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  /**
   * Resolves an object key to a path, refusing anything that escapes the root.
   *
   * Keys are generated server-side, so traversal should be impossible — but a path
   * built from a key is exactly the place where "should be impossible" becomes a CVE.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root)) {
      throw new Error(`object key escapes the store root: ${key}`);
    }
    return path;
  }
}

/**
 * Placeholder for MinIO or S3.
 *
 * Throws rather than degrading to local disk. A deployment that thinks it is writing to
 * durable, replicated storage and is actually writing to a container filesystem would
 * lose every document on the next restart, silently.
 */
@Injectable()
export class UnconfiguredObjectStore extends ObjectStore {
  readonly kind = 'unconfigured';

  async put(): Promise<StoredObject> {
    throw new Error(
      'No object store is configured. Set OBJECT_STORE_ENDPOINT and its credentials, or ' +
        'documents cannot be stored.',
    );
  }

  async get(): Promise<Buffer> {
    throw new Error('No object store is configured.');
  }

  async deleteRejected(): Promise<void> {
    throw new Error('No object store is configured.');
  }
}
