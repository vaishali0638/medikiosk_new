import { Logger } from '@nestjs/common';
import type { ComposeInput } from './deterministic-composer';

/**
 * A generator that turns structured answers into a draft.
 *
 * The interface is narrow on purpose. A generator receives only the structured answers
 * and document labels — never the patient's identity, never the raw documents, never
 * previous visits — and returns a candidate that the safety validator then judges. It has
 * no way to write anything, and its output is not a record until it passes.
 */
export interface DraftGenerator {
  readonly name: string;
  readonly version: string;
  /** Returns a draft candidate. Anything at all: the validator decides. */
  generate(input: ComposeInput): Promise<unknown>;
}

export const DRAFT_GENERATOR = Symbol('DRAFT_GENERATOR');

/**
 * What runs when `FEATURE_AI_SUMMARY` is off, or when no generator is configured.
 *
 * It throws rather than returning an empty draft. The service treats a throw as "fall back
 * to the deterministic composer", which is the specified behaviour and produces a complete,
 * labelled draft. Returning something empty instead would look to a clinician like a
 * patient who answered nothing.
 */
export class UnavailableGenerator implements DraftGenerator {
  readonly name = 'unavailable';
  readonly version = '0';

  generate(): Promise<unknown> {
    return Promise.reject(new Error('no draft generator configured'));
  }
}

/**
 * Wraps a generator with a timeout and turns every failure into the same rejection.
 *
 * A model that hangs must not hold up a patient's token. Ten seconds is already longer
 * than anyone should stand at a kiosk waiting for prose that a rule-based composer can
 * produce instantly.
 */
export class TimeBoundedGenerator implements DraftGenerator {
  private readonly logger = new Logger(TimeBoundedGenerator.name);

  constructor(
    private readonly inner: DraftGenerator,
    private readonly timeoutMs: number = 10_000,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get version(): string {
    return this.inner.version;
  }

  async generate(input: ComposeInput): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.inner.generate(input),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('draft generator timed out')), this.timeoutMs);
        }),
      ]);
    } catch (error) {
      // Logged without the draft: a failed generation still concerns one patient's
      // clinical narrative, and the reason is in the message, not the content.
      this.logger.warn(
        `draft generator ${this.inner.name} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
