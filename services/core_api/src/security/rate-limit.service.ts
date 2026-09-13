import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';

export interface RateLimit {
  /** How many attempts are allowed in a window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * What each protected action allows.
 *
 * The numbers are deliberately generous for a person and tight for a script. A patient
 * mistyping their number three times must not be locked out of care; a script trying ten
 * thousand numbers must be. Where the two conflict, the patient wins and the limit is
 * looser — a kiosk that refuses a real patient has failed at its actual job.
 */
export const RATE_LIMITS = {
  /**
   * Per device, so one kiosk cannot be turned into an SMS pump aimed at many numbers.
   *
   * There is deliberately no per-NUMBER bucket here: `OtpService.assertSendRateOk` has
   * limited sends per mobile since Phase 5, and a second limiter on the same thing would
   * mean the effective limit is the smaller of two numbers in two files — which is how a
   * limit gets loosened by someone who only found one of them.
   */
  OTP_REQUEST_PER_KIOSK: { limit: 30, windowSeconds: 15 * 60 },
  /** Staff credential stuffing. */
  STAFF_SIGN_IN: { limit: 10, windowSeconds: 15 * 60 },
  /** QR brute force. A patient scans once or twice; a script scans forever. */
  ARRIVAL_CHECK_IN: { limit: 20, windowSeconds: 5 * 60 },
} as const satisfies Record<string, RateLimit>;

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Counts one attempt and refuses when the window is full.
   *
   * Counted in the database rather than in memory. A per-process counter is not a rate
   * limit on a deployment with two instances behind a load balancer — the attacker gets N
   * per instance and the limit quietly doubles. At kiosk volumes the write costs nothing.
   *
   * The subject is hashed, so a leaked backup of the bucket table is not a list of which
   * mobile numbers tried to check in and when.
   */
  async consume(action: keyof typeof RATE_LIMITS, subject: string): Promise<void> {
    const limit = RATE_LIMITS[action];
    const windowStart = this.windowStart(limit.windowSeconds);
    const key = `${action}:${hash(subject)}`;

    const row = await this.db
      .insertInto('rate_limit_bucket')
      .values({ bucket_key: key, window_started_at: windowStart, attempt_count: 1 })
      .onConflict((oc) =>
        oc.columns(['bucket_key', 'window_started_at']).doUpdateSet({
          attempt_count: sql<number>`rate_limit_bucket.attempt_count + 1`,
        }),
      )
      .returning('attempt_count')
      .executeTakeFirstOrThrow();

    if (row.attempt_count > limit.limit) {
      // Logged with the action but never the subject: the whole point of hashing it is
      // that this table and this log do not become a record of who tried what.
      this.logger.warn(`rate limit reached for ${action}`);
      throw new DomainError('RATE_LIMITED', '', `${action} limit of ${limit.limit} reached`);
    }
  }

  /** Deletes windows that can no longer be current. Safe to run at any time. */
  async sweep(): Promise<number> {
    const longest = Math.max(...Object.values(RATE_LIMITS).map((l) => l.windowSeconds));
    const result = await this.db
      .deleteFrom('rate_limit_bucket')
      .where('window_started_at', '<', new Date(Date.now() - longest * 2000))
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  /**
   * Fixed windows, not sliding.
   *
   * A fixed window lets an attacker send 2N attempts across a boundary, which is a real
   * weakness of the approach and is accepted here: the alternative needs either a sorted
   * set per subject or a leaky bucket with a timer, and neither is worth the complexity
   * when the limits already sit far below what any script needs to be useful.
   */
  private windowStart(windowSeconds: number): Date {
    const ms = windowSeconds * 1000;
    return new Date(Math.floor(Date.now() / ms) * ms);
  }
}

function hash(subject: string): string {
  return createHash('sha256').update(subject).digest('hex').slice(0, 32);
}
