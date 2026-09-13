import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { LocalEncryptedObjectStore, UnconfiguredObjectStore } from './object-store';

function configFor(values: Record<string, unknown>): ConfigService<Env, true> {
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('LocalEncryptedObjectStore', () => {
  let root: string;
  let store: LocalEncryptedObjectStore;

  const original = Buffer.from('a prescription, as scanned bytes', 'utf8');

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'medikiosk-objects-'));
    store = new LocalEncryptedObjectStore(
      configFor({
        OBJECT_STORE_LOCAL_ROOT: root,
        OBJECT_ENCRYPTION_KEY: 'a'.repeat(48),
        OBJECT_ENCRYPTION_KEY_ID: 'test',
      }),
    );
  });

  it('returns exactly the bytes that were stored', async () => {
    const stored = await store.put('visit/doc-1', original);
    expect(await store.get(stored.objectKey)).toEqual(original);
  });

  it('hashes the ORIGINAL, not the ciphertext', async () => {
    const stored = await store.put('visit/doc-1', original);
    // The hash has to prove the bytes the patient uploaded are the bytes the doctor sees,
    // independent of how they were stored.
    expect(stored.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  });

  it('writes ciphertext to disk, not the document', async () => {
    await store.put('visit/doc-1', original);
    const onDisk = await readFile(join(root, 'visit/doc-1'));

    // A storage administrator holds ciphertext.
    expect(onDisk.includes(original)).toBe(false);
    expect(onDisk.byteLength).toBeGreaterThan(original.byteLength);
  });

  it('records the key it used, so keys can rotate', async () => {
    expect((await store.put('visit/doc-1', original)).encryptionKeyId).toBe('test');
  });

  it('detects a tampered file rather than returning altered bytes', async () => {
    const stored = await store.put('visit/doc-1', original);
    const path = join(root, stored.objectKey);
    const raw = await readFile(path);
    const last = raw.length - 1;
    raw.writeUInt8((raw.readUInt8(last) ^ 0xff) & 0xff, last);
    await writeFile(path, raw);

    // GCM authentication is what makes "never silently modified" true in practice.
    await expect(store.get(stored.objectKey)).rejects.toThrow();
  });

  it('cannot be read with a different key', async () => {
    const stored = await store.put('visit/doc-1', original);
    const other = new LocalEncryptedObjectStore(
      configFor({
        OBJECT_STORE_LOCAL_ROOT: root,
        OBJECT_ENCRYPTION_KEY: 'b'.repeat(48),
        OBJECT_ENCRYPTION_KEY_ID: 'test',
      }),
    );
    await expect(other.get(stored.objectKey)).rejects.toThrow();
  });

  it('refuses to overwrite an existing object', async () => {
    await store.put('visit/doc-1', original);
    // There is no update operation, and put must not become one by accident.
    await expect(store.put('visit/doc-1', Buffer.from('replaced'))).rejects.toThrow();
  });

  it('refuses a key that escapes the store root', async () => {
    // Keys are generated server-side, so this should be impossible — which is exactly
    // where "should be impossible" becomes a CVE.
    await expect(store.put('../../etc/passwd', original)).rejects.toThrow(/escapes/);
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/escapes/);
  });

  it('refuses to run in production without a configured key', () => {
    expect(
      () =>
        new LocalEncryptedObjectStore(
          configFor({ NODE_ENV: 'production', OBJECT_STORE_LOCAL_ROOT: root }),
        ),
    ).toThrow(/OBJECT_ENCRYPTION_KEY is required/);
  });
});

describe('UnconfiguredObjectStore', () => {
  it('throws rather than falling back to local disk', async () => {
    // A deployment that thinks it is writing to durable storage and is actually writing
    // to a container filesystem would lose every document on the next restart, silently.
    const store = new UnconfiguredObjectStore();
    await expect(store.put()).rejects.toThrow(/No object store is configured/);
    await expect(store.get()).rejects.toThrow(/No object store is configured/);
  });
});
