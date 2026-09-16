import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { HttpSmsAdapter } from './http-sms.adapter';
import { SandboxSmsAdapter, SmsAdapter, UnconfiguredSmsAdapter } from './sms.adapter';

/**
 * Chooses the SMS transport from configuration.
 *
 * Extracted from the module so the choice can be unit-tested. The three outcomes are
 * deliberately distinct: one that logs (development), one that sends, and one that throws.
 * There is no fourth that quietly does nothing — a kiosk whose codes go nowhere, with no
 * error anywhere, is the failure mode this whole file exists to avoid.
 */
export function buildSmsAdapter(config: ConfigService<Env, true>): SmsAdapter {
  const kind = config.get('SMS_ADAPTER', { infer: true });

  if (kind === 'sandbox') return new SandboxSmsAdapter();

  if (kind === 'http') {
    const url = config.get('SMS_API_URL', { infer: true });
    const apiKey = config.get('SMS_API_KEY', { infer: true });
    const senderId = config.get('SMS_SENDER_ID', { infer: true });
    const templateId = config.get('SMS_DLT_TEMPLATE_ID', { infer: true });

    // Production is already stopped by assertProductionAdapters. This guard covers a
    // development box set to `http` with half the settings filled in, where the useful
    // outcome is a refusal naming the gap rather than silent non-delivery.
    const provider = config.get('SMS_PROVIDER', { infer: true });
    // Only `generic` needs an explicit URL; the named providers have fixed endpoints.
    const resolvedUrl = url ?? '';
    if (!apiKey || !senderId || !templateId) return new UnconfiguredSmsAdapter();
    if (provider === 'generic' && !resolvedUrl) return new UnconfiguredSmsAdapter();

    return new HttpSmsAdapter({
      provider,
      accountSid: config.get('SMS_ACCOUNT_SID', { infer: true }),
      url: resolvedUrl,
      apiKey,
      authHeader: config.get('SMS_AUTH_HEADER', { infer: true }),
      senderId,
      templateId,
      timeoutMs: config.get('SMS_TIMEOUT_MS', { infer: true }),
    });
  }

  return new UnconfiguredSmsAdapter();
}
