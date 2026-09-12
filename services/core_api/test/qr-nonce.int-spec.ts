import type { Kysely } from 'kysely';
import type { Database } from '../src/db/database.types';
import { QrNonceRepository } from '../src/arrival/qr-nonce.repository';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

describe('QR nonce (integration)', () => {
  let db: Kysely<Database>;
  let repo: QrNonceRepository;
  let fx: Fixture;

  const inOneHour = (): Date => new Date(Date.now() + 3_600_000);

  beforeAll(async () => {
    db = await createTestDb();
    repo = new QrNonceRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
  });

  it('issues a nonce in the ISSUED state', async () => {
    const nonce = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    expect(nonce.state).toBe('ISSUED');
    expect(nonce.consumed_at).toBeNull();
  });

  it('consumes a valid nonce exactly once', async () => {
    const issued = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    const first = await repo.consume(issued.nonce, fx.kioskId);
    expect(first.ok).toBe(true);

    const second = await repo.consume(issued.nonce, fx.kioskId);
    expect(second).toEqual({ ok: false, reason: 'ALREADY_CONSUMED' });
  });

  it('records which kiosk consumed it, for audit', async () => {
    const issued = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });
    const result = await repo.consume(issued.nonce, fx.kioskId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nonce.consumed_by_kiosk).toBe(fx.kioskId);
      expect(result.nonce.consumed_at).toBeInstanceOf(Date);
    }
  });

  it('refuses a nonce that has already expired', async () => {
    const issued = await db
      .insertInto('qr_nonce')
      .values({
        pre_checkin_id: fx.preCheckinId,
        nonce: '11111111-1111-4111-8111-111111111111',
        signing_key_id: 'key-1',
        issued_at: new Date(Date.now() - 7_200_000),
        expires_at: new Date(Date.now() - 3_600_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(await repo.consume(issued.nonce, fx.kioskId)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });

  it('refuses an unknown nonce without disclosing anything', async () => {
    const result = await repo.consume('22222222-2222-4222-8222-222222222222', fx.kioskId);
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('retires the previous QR when a new one is issued, so only one is ever live', async () => {
    const first = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });
    const second = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    expect(await repo.consume(first.nonce, fx.kioskId)).toEqual({ ok: false, reason: 'REVOKED' });
    expect((await repo.consume(second.nonce, fx.kioskId)).ok).toBe(true);
  });

  it('lets only one of two simultaneous scans win', async () => {
    const issued = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    // Two kiosks scanning the same code at the same instant. Exactly one must succeed;
    // this is the QR-replay property, and it has to hold under real concurrency.
    const results = await Promise.all([
      repo.consume(issued.nonce, fx.kioskId),
      repo.consume(issued.nonce, fx.kioskId),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('holds under ten simultaneous scans', async () => {
    const issued = await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.consume(issued.nonce, fx.kioskId)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('rejects a second live nonce at the database level, not just in application code', async () => {
    await repo.issue({
      preCheckinId: fx.preCheckinId,
      signingKeyId: 'key-1',
      expiresAt: inOneHour(),
    });

    // Bypasses the repository entirely: the partial unique index must still refuse.
    await expect(
      db
        .insertInto('qr_nonce')
        .values({
          pre_checkin_id: fx.preCheckinId,
          nonce: '33333333-3333-4333-8333-333333333333',
          signing_key_id: 'key-1',
          expires_at: inOneHour(),
        })
        .execute(),
    ).rejects.toThrow(/qr_nonce_one_live_per_precheckin/);
  });

  it('marks lapsed nonces expired', async () => {
    await db
      .insertInto('qr_nonce')
      .values({
        pre_checkin_id: fx.preCheckinId,
        nonce: '44444444-4444-4444-8444-444444444444',
        signing_key_id: 'key-1',
        issued_at: new Date(Date.now() - 7_200_000),
        expires_at: new Date(Date.now() - 60_000),
      })
      .execute();

    expect(await repo.expireLapsed()).toBe(1);
    const row = await repo.findByNonce('44444444-4444-4444-8444-444444444444');
    expect(row?.state).toBe('EXPIRED');
  });
});
