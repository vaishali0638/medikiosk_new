import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { ObjectEncryption } from './object-encryption';
import { ObjectStore, type StoredObject } from './object-store';

/**
 * Original documents in Supabase Storage.
 *
 * Supabase Storage is S3-compatible, but this uses its REST API rather than an S3 client:
 * three verbs are needed, the whole surface is a PUT, a GET and a DELETE against
 * `/storage/v1/object/<bucket>/<key>`, and an S3 SDK would be a large dependency to add for
 * that. Swapping to S3 proper later is a transport change behind the same interface.
 *
 * WHAT SUPABASE HOLDS IS CIPHERTEXT. The envelope is sealed here, by the application,
 * before the bytes leave the process — see ObjectEncryption for why. A Supabase project
 * administrator, or anyone with the service-role key, gets encrypted blobs and nothing
 * else. That matters more than usual with a managed provider: the bucket is one misclick
 * away from public, and a public bucket of encrypted envelopes is an embarrassment rather
 * than a breach.
 *
 * The bucket MUST be private regardless. `assertBucketIsPrivate` checks it at boot rather
 * than trusting the setting, because the cost of being wrong is every patient's
 * prescriptions on the open internet.
 */
@Injectable()
export class SupabaseObjectStore extends ObjectStore {
  readonly kind = 'supabase';
  private readonly logger = new Logger(SupabaseObjectStore.name);

  private readonly url: string;
  private readonly serviceKey: string;
  private readonly bucket: string;
  private readonly crypto: ObjectEncryption;

  constructor(
    config: ConfigService<Env, true>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    const url = config.get('SUPABASE_URL', { infer: true });
    const key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when OBJECT_STORE=supabase',
      );
    }

    this.url = url.replace(/\/$/, '');
    this.serviceKey = key;
    this.bucket = config.get('SUPABASE_STORAGE_BUCKET', { infer: true });
    this.crypto = new ObjectEncryption(config);
  }

  private endpoint(key: string): string {
    // Keys are generated server-side, but encoding each segment costs nothing and is the
    // difference between a key with a slash in it addressing a nested object and it
    // addressing something else entirely.
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${this.url}/storage/v1/object/${this.bucket}/${path}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    };
  }

  async put(key: string, plaintext: Buffer): Promise<StoredObject> {
    const { envelope, sha256 } = this.crypto.seal(plaintext);

    const response = await this.fetchImpl(this.endpoint(key), {
      method: 'POST',
      headers: {
        ...this.headers(),
        'content-type': 'application/octet-stream',
        // Refuse to overwrite. Originals are immutable — there is no update operation in
        // this interface precisely so nothing can silently modify one — and an upsert
        // would put that back by the side door.
        'x-upsert': 'false',
      },
      body: new Uint8Array(envelope),
    });

    if (!response.ok) {
      throw new Error(`Supabase Storage rejected an upload (${response.status})`);
    }

    return {
      objectKey: key,
      sha256,
      byteSize: plaintext.byteLength,
      encryptionKeyId: this.crypto.keyId,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.fetchImpl(this.endpoint(key), { headers: this.headers() });
    if (!response.ok) {
      throw new Error(`Supabase Storage could not read an object (${response.status})`);
    }
    return this.crypto.open(Buffer.from(await response.arrayBuffer()));
  }

  async deleteRejected(key: string): Promise<void> {
    await this.fetchImpl(this.endpoint(key), {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => undefined);
  }

  /**
   * Refuses to start against a public bucket.
   *
   * Checked rather than assumed: "we set it to private" is a memory, and the failure mode
   * is every patient's prescriptions readable by URL. Called at boot, so a misconfigured
   * deployment does not start rather than serving happily until somebody notices.
   */
  async assertBucketIsPrivate(): Promise<void> {
    const response = await this.fetchImpl(`${this.url}/storage/v1/bucket/${this.bucket}`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(
        `Supabase bucket "${this.bucket}" is not reachable (${response.status}). ` +
          'Create it, private, before starting.',
      );
    }

    const bucket = (await response.json()) as { public?: boolean };
    if (bucket.public === true) {
      throw new Error(
        `Supabase bucket "${this.bucket}" is PUBLIC. Original medical documents must not be ` +
          'in a public bucket. Set it to private in the Supabase dashboard.',
      );
    }

    this.logger.log(`Supabase Storage ready: private bucket "${this.bucket}"`);
  }
}
