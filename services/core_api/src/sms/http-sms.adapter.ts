import { Injectable, Logger } from '@nestjs/common';
import { maskTail } from '../common/redact';
import { SmsAdapter, type SmsMessage, type SmsSendResult } from './sms.adapter';

export interface HttpSmsConfig {
  /** Gateway endpoint. Provider-specific; MSG91, Gupshup and Kaleyra all accept JSON POST. */
  readonly url: string;
  /** The credential. Sent in `authHeader`, never logged. */
  readonly apiKey: string;
  /**
   * Header the credential goes in. `Authorization` for most gateways, `authkey` for MSG91.
   * Configurable because getting this wrong is the single most common integration failure
   * and the symptom — a 401 with no body — tells you nothing.
   */
  readonly authHeader: string;
  /**
   * Registered sender ID, six alphabetic characters in India (e.g. `AYUSHK`).
   *
   * Not decoration: under TRAI's DLT regime an unregistered header is rejected by the
   * operator, not by the gateway, so the send succeeds and the message never arrives.
   */
  readonly senderId: string;
  /**
   * DLT template id. India requires every transactional SMS to match a template the
   * sender registered with the operator, word for word. A message that does not match is
   * dropped silently downstream.
   */
  readonly templateId: string;
  /** A patient is standing at a kiosk. A gateway that has not answered by now has failed. */
  readonly timeoutMs: number;
}

/**
 * Real SMS transport over HTTP.
 *
 * Deliberately provider-agnostic rather than an SDK for one vendor: which gateway a
 * government hospital may use is a procurement decision, and every Indian provider of
 * consequence accepts a JSON POST with an API key header.
 *
 * Three things this will not do:
 *
 *  - It will not log the message body. The body contains a live one-time code, and a log
 *    that holds those is a credential store with worse access control. The destination is
 *    masked too, because logs get shared.
 *  - It will not retry. A retried OTP is a second SMS to a patient who is already reading
 *    the first, and the send-rate limiter in OtpService counts it. One attempt, then an
 *    honest failure.
 *  - It will not report success it did not observe. A non-2xx, a timeout or a transport
 *    error all return `delivered: false`, which surfaces to the patient as "we could not
 *    send a code" rather than as a code that silently never arrives.
 *
 * NOT VERIFIED AGAINST A LIVE GATEWAY. The shape is right and the unit tests cover the
 * failure paths, but no message has been sent through a real provider from this code: that
 * needs an account, a registered sender ID and a DLT-approved template, none of which
 * exist outside a hospital's own procurement.
 */
@Injectable()
export class HttpSmsAdapter extends SmsAdapter {
  readonly kind = 'http';
  private readonly logger = new Logger('HttpSmsAdapter');

  constructor(
    private readonly config: HttpSmsConfig,
    /** Injected so tests can drive the failure paths without a network. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          [this.config.authHeader]: this.config.apiKey,
        },
        body: JSON.stringify({
          // 91 is India's country code. The contract stores ten digits without it, and a
          // gateway handed a bare ten-digit number routes it nowhere.
          mobiles: `91${message.mobile}`,
          sender: this.config.senderId,
          template_id: this.config.templateId,
          message: message.body,
        }),
      });

      if (!response.ok) {
        // Status and correlation id only. The body may echo the message back.
        this.logger.error(
          `SMS gateway refused (${response.status}) for ${maskTail(message.mobile)} ` +
            `correlationId=${message.correlationId}`,
        );
        return { delivered: false };
      }

      const providerRef = response.headers.get('x-message-id') ?? undefined;
      return providerRef === undefined ? { delivered: true } : { delivered: true, providerRef };
    } catch (error) {
      // AbortError for the timeout, TypeError for DNS and connection failures. Neither
      // message is allowed to carry the body, so only the class of failure is logged.
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.error(
        `SMS gateway unreachable (${reason}) for ${maskTail(message.mobile)} ` +
          `correlationId=${message.correlationId}`,
      );
      return { delivered: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
