import { Injectable, Logger } from '@nestjs/common';
import { maskTail } from '../common/redact';

export interface SmsMessage {
  readonly mobile: string;
  readonly body: string;
  /** Correlates the send with the journey it belongs to. Carries no patient data. */
  readonly correlationId: string;
}

export interface SmsSendResult {
  readonly delivered: boolean;
  /** Provider reference for support. Never contains the message body. */
  readonly providerRef?: string;
}

/** Replaceable SMS transport. Real gateways are hospital- and country-specific. */
export abstract class SmsAdapter {
  abstract send(message: SmsMessage): Promise<SmsSendResult>;
  abstract readonly kind: string;
}

/**
 * Development stand-in.
 *
 * Writes the message to the log so a developer can complete an OTP flow locally. That is
 * exactly why it must never run in production, and `assertProductionAdapters` refuses to
 * boot with it — a production log containing live one-time codes would be a credential
 * store in disguise.
 *
 * Even here the destination number is masked. Developers share logs.
 */
@Injectable()
export class SandboxSmsAdapter extends SmsAdapter {
  readonly kind = 'sandbox';
  private readonly logger = new Logger('SandboxSmsAdapter');

  async send(message: SmsMessage): Promise<SmsSendResult> {
    this.logger.warn(
      `SANDBOX SMS (never use in production) -> ${maskTail(message.mobile)}: ${message.body}`,
    );
    return { delivered: true, providerRef: `sandbox-${Date.now()}` };
  }
}

/**
 * Placeholder for a real gateway.
 *
 * Not implemented: the transport is hospital-specific and requires credentials, a sender
 * ID and DLT registration in India. It throws rather than silently succeeding, so a
 * misconfigured deployment fails at the first send instead of leaving patients waiting
 * for codes that were never sent.
 */
@Injectable()
export class UnconfiguredSmsAdapter extends SmsAdapter {
  readonly kind = 'unconfigured';

  async send(): Promise<SmsSendResult> {
    throw new Error(
      'No SMS gateway is configured. Set SMS_ADAPTER and the gateway credentials, or the ' +
        'kiosk cannot send one-time codes.',
    );
  }
}
