import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { DB_POOL } from '../db/db.module';

/** What a listener is told. No patient data — see migration 0025. */
export interface WorklistChange {
  readonly hospitalId: string;
  readonly departmentId: string;
}

type Listener = (change: WorklistChange) => void;

/**
 * Turns `NOTIFY medikiosk_worklist` into events the doctor console can subscribe to.
 *
 * One dedicated connection for the whole process, held outside the pool. LISTEN is a
 * property of a session, so a pooled connection would stop listening the moment it was
 * handed to somebody else — and would do it silently, leaving a console that looks
 * connected and never updates again.
 *
 * The event says only which department changed. Subscribers re-fetch through the normal
 * authenticated, department-scoped endpoint, so nothing here has to decide who may see
 * what. That is the point: a notification channel that carried the worklist itself would
 * be a second path to patient data with its own access-control bugs.
 *
 * NOT AVAILABLE THROUGH A TRANSACTION POOLER. Supabase's Supavisor on :6543 hands a
 * different backend to each statement, so a LISTEN issued on one is not in effect for the
 * next. Use the direct or session-mode connection; `connect()` logs plainly when it cannot
 * establish the listener rather than degrading to a console that never updates.
 */
@Injectable()
export class WorklistEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorklistEventsService.name);
  private readonly listeners = new Set<Listener>();
  private client: PoolClient | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.listeners.clear();
    this.client?.release();
    this.client = null;
  }

  /** Subscribes. Returns the unsubscribe; callers must invoke it when the client goes away. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the listener connection is live. Reported on the health endpoint. */
  get connected(): boolean {
    return this.client !== null;
  }

  private async connect(): Promise<void> {
    if (this.closing) return;

    try {
      const client = await this.pool.connect();
      client.on('notification', (message) => this.dispatch(message.payload));
      // A dropped listener connection is the failure that looks like nothing is happening.
      // Reconnect rather than leave every console silently stale.
      client.on('error', (error) => {
        this.logger.warn(`worklist listener lost: ${error.message}`);
        this.client = null;
        this.scheduleReconnect();
      });

      await client.query('LISTEN medikiosk_worklist');
      this.client = client;
      this.logger.log('listening for worklist changes');
    } catch (error) {
      this.logger.warn(
        `could not start the worklist listener (${
          error instanceof Error ? error.message : 'unknown'
        }). The console will fall back to polling.`,
      );
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5_000);
  }

  private dispatch(payload: string | undefined): void {
    if (!payload) return;
    let change: WorklistChange;
    try {
      change = JSON.parse(payload) as WorklistChange;
    } catch {
      // A payload this process cannot parse is not worth crashing a doctor's stream over.
      return;
    }
    if (!change.hospitalId || !change.departmentId) return;

    for (const listener of this.listeners) {
      // One slow or throwing subscriber must not stop the others being told.
      try {
        listener(change);
      } catch (error) {
        this.logger.warn(
          `a worklist subscriber threw: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }
}
