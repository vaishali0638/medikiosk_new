import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { ObjectEncryption } from './object-encryption';

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

@Injectable()
export class LocalEncryptedObjectStore extends ObjectStore {
  readonly kind = 'local-encrypted';
  private readonly root: string;
  private readonly crypto: ObjectEncryption;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.root = resolve(
      config.get('OBJECT_STORE_LOCAL_ROOT', { infer: true }) ?? './.data/objects',
    );
    this.crypto = new ObjectEncryption(config);
  }

  async put(key: string, plaintext: Buffer): Promise<StoredObject> {
    const { envelope, sha256 } = this.crypto.seal(plaintext);
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // `wx` fails if the object exists. Originals are immutable.
    await writeFile(path, envelope, { flag: 'wx' });

    return {
      objectKey: key,
      sha256,
      byteSize: plaintext.byteLength,
      encryptionKeyId: this.crypto.keyId,
    };
  }

  async get(key: string): Promise<Buffer> {
    return this.crypto.open(await readFile(this.pathFor(key)));
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
