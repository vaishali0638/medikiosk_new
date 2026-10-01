import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { maskTail } from '../common/redact';

export type SupabaseOtpOutcome = 'verified' | 'rejected' | 'unavailable';

/**
 * One-time codes sent and checked by Supabase Auth.
 *
 * Supabase generates the code, sends it through whichever SMS provider the project has
 * configured, and verifies it. This service never sees the code — which is the point of
 * using it, and also the thing to understand about what changes:
 *
 *  - There is nothing to HMAC and store, so the row records `verifier = 'SUPABASE'` and an
 *    empty hash, enforced by a constraint rather than left to convention.
 *  - The expiry and attempt ceiling are Supabase's, not ours. Ours still apply on top:
 *    the send-rate limit, the audit trail and the attempt counter are all kept, because
 *    they are the parts a hospital is accountable for.
 *  - Every patient phone number becomes a user in the Supabase project. That is how
 *    Supabase's phone auth works and it is a real consequence: those rows are patient
 *    identifiers living outside the clinical schema, in a table this application does not
 *    control the retention of.
 *
 * `create_user` is left at Supabase's default of true deliberately. Setting it false makes
 * the response differ for a number Supabase has not seen before, which turns the kiosk
 * into a way to test which numbers are registered — the exact property the local
 * implementation goes out of its way to preserve.
 */
@Injectable()
export class SupabaseOtpTransport {
  private readonly logger = new Logger(SupabaseOtpTransport.name);
  private readonly url: string;
  private readonly anonKey: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = config.get('SUPABASE_URL', { infer: true });
    // The ANON key, not the service role: this is the public auth surface, and the
    // service-role key bypasses row-level security. Sending it here would be handing a
    // master credential to an endpoint that does not need one.
    const anonKey = config.get('SUPABASE_ANON_KEY', { infer: true });
    if (!url || !anonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required when OTP_PROVIDER=supabase');
    }
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
    this.timeoutMs = config.get('SMS_TIMEOUT_MS', { infer: true });
  }

  /** India's country code. The contract stores ten digits; Supabase wants E.164. */
  private e164(mobile: string): string {
    return `+91${mobile}`;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', apikey: this.anonKey };
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Asks Supabase to send a code. Returns whether it accepted the request. */
  async send(mobile: string, correlationId: string): Promise<boolean> {
    const response = await this.post('otp', { phone: this.e164(mobile) });

    if (response === null) {
      this.logger.error(
        `Supabase Auth unreachable for ${maskTail(mobile)} correlationId=${correlationId}`,
      );
      return false;
    }
    if (!response.ok) {
      // Status only. The body can echo the phone number back.
      this.logger.error(
        `Supabase Auth refused an OTP send (${response.status}) for ${maskTail(mobile)} ` +
          `correlationId=${correlationId}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Checks a code with Supabase.
   *
   * Three outcomes, not two. A wrong code and an unreachable Supabase must not look the
   * same: the first is the patient's mistake and costs them an attempt, the second is an
   * outage and must not.
   */
  async verify(mobile: string, code: string, correlationId: string): Promise<SupabaseOtpOutcome> {
    const response = await this.post('verify', {
      phone: this.e164(mobile),
      token: code,
      type: 'sms',
    });

    if (response === null) {
      this.logger.error(
        `Supabase Auth unreachable during verify for ${maskTail(mobile)} ` +
          `correlationId=${correlationId}`,
      );
      return 'unavailable';
    }
    if (response.ok) return 'verified';

    // 400 and 403 are Supabase saying the code is wrong or expired. A 5xx is Supabase
    // being broken, and charging a patient an attempt for that would be unfair and would
    // lock them out of a working number.
    if (response.status >= 500) return 'unavailable';
    return 'rejected';
  }
}
