import type { Kysely } from 'kysely';
import type { Database } from '../src/db/database.types';
import {
  TokenRequestRepository,
  tokenIdempotencyKey,
} from '../src/arrival/token-request.repository';
import { InvalidStateTransitionError } from '../src/state-machines';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

describe('token request (integration)', () => {
  let db: Kysely<Database>;
  let repo: TokenRequestRepository;
  let fx: Fixture;
  let key: string;

  beforeAll(async () => {
    db = await createTestDb();
    repo = new TokenRequestRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
    key = tokenIdempotencyKey(fx.kioskCode, fx.preCheckinId);
  });

  const open = (): Promise<{ created: boolean }> =>
    repo.open({
      preCheckinId: fx.preCheckinId,
      kioskDeviceCode: fx.kioskCode,
      kioskDeviceId: fx.kioskId,
    });

  it('derives the idempotency key from the kiosk and the pre-check-in', () => {
    expect(key).toBe(`${fx.kioskCode}-${fx.preCheckinId}`);
  });

  it('creates one request and reuses it on retry', async () => {
    expect((await open()).created).toBe(true);
    expect((await open()).created).toBe(false);

    const count = await db
      .selectFrom('token_request')
      .select(({ fn }) => fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('creates exactly one request under five concurrent calls', async () => {
    // A patient double-tapping while the kiosk retries a timed-out request.
    const results = await Promise.all(Array.from({ length: 5 }, () => open()));

    expect(results.filter((r) => r.created)).toHaveLength(1);
    const count = await db
      .selectFrom('token_request')
      .select(({ fn }) => fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });

  it('records the token the HIS returned', async () => {
    await open();
    await repo.markRequested(key);
    const issued = await repo.recordIssued({ idempotencyKey: key, hisToken: 'AYU-0247' });

    expect(issued.state).toBe('ISSUED');
    expect(issued.his_token).toBe('AYU-0247');
    expect(issued.issued_at).toBeInstanceOf(Date);
  });

  it('never replaces an already-issued token', async () => {
    await open();
    await repo.markRequested(key);
    await repo.recordIssued({ idempotencyKey: key, hisToken: 'AYU-0247' });

    // A duplicated HIS response, or a replayed webhook, arriving with a different token.
    const again = await repo.recordIssued({ idempotencyKey: key, hisToken: 'AYU-9999' });
    expect(again.his_token).toBe('AYU-0247');
  });

  it('counts attempts so a retry storm is visible in monitoring', async () => {
    await open();
    await repo.markRequested(key);
    await repo.markFailed(key, 'HIS_UNAVAILABLE');
    const retried = await repo.markRequested(key);

    expect(retried.attempt_count).toBe(2);
    expect(retried.state).toBe('REQUESTED');
  });

  it('allows a retry only after a definitive failure', async () => {
    await open();
    await repo.markRequested(key);
    await expect(repo.markRequested(key)).rejects.toThrow(InvalidStateTransitionError);
  });

  it('parks an uncertain outcome for human reconciliation instead of retrying', async () => {
    await open();
    await repo.markRequested(key);
    const parked = await repo.markReconciliationRequired(key, 'HIS timed out after ACK');

    expect(parked.state).toBe('UNKNOWN_RECONCILIATION_REQUIRED');
    // No automated path out. Retrying here could produce a second hospital token.
    await expect(repo.markRequested(key)).rejects.toThrow(InvalidStateTransitionError);
    await expect(repo.recordIssued({ idempotencyKey: key, hisToken: 'AYU-0001' })).rejects.toThrow(
      InvalidStateTransitionError,
    );
  });

  it('lists reconciliation work for the operations dashboard', async () => {
    await open();
    await repo.markRequested(key);
    await repo.markReconciliationRequired(key, 'HIS timed out');

    const pending = await repo.listAwaitingReconciliation();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.reconciliation_note).toBe('HIS timed out');
  });

  it('refuses a second issued token for the same visit at the database level', async () => {
    await open();
    await repo.markRequested(key);
    await repo.recordIssued({ idempotencyKey: key, hisToken: 'AYU-0247' });

    // Bypasses the repository and the idempotency key entirely. The partial unique index
    // must still refuse: one visit, at most one issued token, ever.
    await expect(
      db
        .insertInto('token_request')
        .values({
          pre_checkin_id: fx.preCheckinId,
          kiosk_device_id: fx.kioskId,
          idempotency_key: `OTHER-KIOSK-${fx.preCheckinId}`,
          state: 'ISSUED',
          his_token: 'AYU-9999',
          issued_at: new Date(),
        })
        .execute(),
    ).rejects.toThrow(/token_request_one_issued_per_precheckin/);
  });

  it('refuses an ISSUED row that carries no token', async () => {
    // The CHECK constraint keeps state and data consistent: ISSUED means a token exists.
    await expect(
      db
        .insertInto('token_request')
        .values({
          pre_checkin_id: fx.preCheckinId,
          kiosk_device_id: fx.kioskId,
          idempotency_key: `EMPTY-${fx.preCheckinId}`,
          state: 'ISSUED',
        })
        .execute(),
    ).rejects.toThrow(/token_request_issued_has_token/);
  });
});
