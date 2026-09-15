import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseObjectStore } from './supabase-object-store';
import type { Env } from '../config/env';

const config = (overrides: Record<string, unknown> = {}): ConfigService<Env, true> =>
  ({
    get: (key: string) =>
      ({
        SUPABASE_URL: 'https://abcdefgh.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value-long-enough',
        SUPABASE_STORAGE_BUCKET: 'medikiosk-documents',
        OBJECT_ENCRYPTION_KEY: 'a-development-passphrase-of-sufficient-length',
        OBJECT_ENCRYPTION_KEY_ID: 'test',
        NODE_ENV: 'test',
        ...overrides,
      })[key],
  }) as unknown as ConfigService<Env, true>;

const okResponse = (body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status: 200 });

describe('SupabaseObjectStore', () => {
  const plaintext = Buffer.from('a prescription the patient photographed');

  it('sends ciphertext, never the document', async () => {
    // The whole reason encryption is applied here rather than left to the storage layer:
    // a Supabase administrator, or anyone holding the service-role key, must get an
    // encrypted blob and nothing else.
    let sent = Buffer.alloc(0);
    const store = new SupabaseObjectStore(config(), (async (_url: string, init?: RequestInit) => {
      sent = Buffer.from(init?.body as Uint8Array);
      return okResponse();
    }) as unknown as typeof fetch);

    await store.put('doc/1', plaintext);

    expect(sent.includes(plaintext)).toBe(false);
    expect(sent.length).toBeGreaterThan(plaintext.length);
  });

  it('hashes the original, not what it stored', async () => {
    const store = new SupabaseObjectStore(config(), (async () =>
      okResponse()) as unknown as typeof fetch);

    const stored = await store.put('doc/2', plaintext);

    // sha256 of the plaintext. The hash has to prove the bytes the patient uploaded are
    // the bytes the doctor sees, independent of the storage backend.
    expect(stored.sha256).toBe(createHash('sha256').update(plaintext).digest('hex'));
    expect(stored.byteSize).toBe(plaintext.byteLength);
  });

  it('round-trips a document through seal and open', async () => {
    let held = Buffer.alloc(0);
    const store = new SupabaseObjectStore(config(), (async (_url: string, init?: RequestInit) => {
      if (init && init?.method === 'POST') {
        held = Buffer.from(init?.body as Uint8Array);
        return okResponse();
      }
      return new Response(held, { status: 200 });
    }) as unknown as typeof fetch);

    await store.put('doc/3', plaintext);
    await expect(store.get('doc/3')).resolves.toEqual(plaintext);
  });

  it('refuses to overwrite an original', async () => {
    let upsert: string | undefined;
    const store = new SupabaseObjectStore(config(), (async (_url: string, init?: RequestInit) => {
      upsert = ((init?.headers ?? {}) as Record<string, string>)['x-upsert'];
      return okResponse();
    }) as unknown as typeof fetch);

    await store.put('doc/4', plaintext);

    // There is no update operation in the interface precisely so nothing can silently
    // modify an original. An upsert would put that back by the side door.
    expect(upsert).toBe('false');
  });

  it('will not start against a public bucket', async () => {
    const store = new SupabaseObjectStore(config(), (async () =>
      okResponse({ public: true })) as unknown as typeof fetch);

    // Checked rather than assumed. "We set it to private" is a memory; the failure mode is
    // every patient's prescriptions readable by URL.
    await expect(store.assertBucketIsPrivate()).rejects.toThrow(/PUBLIC/);
  });

  it('will not start when the bucket does not exist', async () => {
    const store = new SupabaseObjectStore(
      config(),
      (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
    );

    await expect(store.assertBucketIsPrivate()).rejects.toThrow(/not reachable/);
  });

  it('accepts a private bucket', async () => {
    const store = new SupabaseObjectStore(config(), (async () =>
      okResponse({ public: false })) as unknown as typeof fetch);

    await expect(store.assertBucketIsPrivate()).resolves.toBeUndefined();
  });

  it('refuses to construct without credentials', () => {
    expect(() => new SupabaseObjectStore(config({ SUPABASE_SERVICE_ROLE_KEY: undefined }))).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
