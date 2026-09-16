import type { SmsMessage } from './sms.adapter';

/**
 * What a gateway wants, and how to tell whether it actually accepted the message.
 *
 * Two things every Indian SMS provider gets wrong from an integrator's point of view, and
 * both are why this is a per-provider profile rather than one JSON shape:
 *
 *  1. THE REQUEST SHAPES ARE ALL DIFFERENT. Twilio is form-encoded with Basic auth; MSG91
 *     is JSON with an `authkey` header and a recipients array; Fast2SMS is JSON with the
 *     key in `authorization`. A single body satisfies none of them.
 *
 *  2. MOST RETURN HTTP 200 FOR A FAILURE. MSG91 answers `{"type":"error"}` with a 200, and
 *     Fast2SMS `{"return":false}`. An adapter that treats 200 as delivered reports success
 *     for a message that was never sent — and the patient waits at the kiosk for a code
 *     that is not coming, with nothing in any log to say why. `accepted` exists to read
 *     the body rather than the status line.
 */
export interface SmsProviderProfile {
  readonly id: string;
  /** Endpoint, when the provider has a fixed one. `generic` takes SMS_API_URL instead. */
  readonly defaultUrl?: string;
  buildRequest(message: SmsMessage, config: SmsRequestConfig): SmsRequest;
  /** Whether the response body says the gateway took it. Given a 2xx response only. */
  accepted(body: string): { ok: boolean; reference?: string; reason?: string };
}

export interface SmsRequestConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly senderId: string;
  readonly templateId: string;
  /** Twilio only: the account SID, and the number messages come from. */
  readonly accountSid?: string | undefined;
}

export interface SmsRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** 91 is India's country code. The contract stores ten digits without it. */
const withCountryCode = (mobile: string): string => `91${mobile}`;

const parse = (body: string): Record<string, unknown> => {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/**
 * MSG91 — the most common transactional gateway in Indian hospitals.
 *
 * Flow API: the message text lives in a DLT-approved template registered at MSG91, and the
 * code is substituted into a named variable. The body here therefore carries the CODE, not
 * the sentence — the sentence is the template, and sending our own would be rejected by
 * the operator even though MSG91 accepts it.
 */
const msg91: SmsProviderProfile = {
  id: 'msg91',
  defaultUrl: 'https://control.msg91.com/api/v5/flow',
  buildRequest: (message, config) => ({
    url: config.url,
    headers: { 'content-type': 'application/json', authkey: config.apiKey },
    body: JSON.stringify({
      template_id: config.templateId,
      sender: config.senderId,
      short_url: '0',
      recipients: [{ mobiles: withCountryCode(message.mobile), code: extractCode(message.body) }],
    }),
  }),
  accepted: (body) => {
    const json = parse(body);
    const type = typeof json['type'] === 'string' ? (json['type'] as string) : '';
    if (type.toLowerCase() === 'success') {
      const ref = json['message'];
      return { ok: true, ...(typeof ref === 'string' ? { reference: ref } : {}) };
    }
    const reason = typeof json['message'] === 'string' ? (json['message'] as string) : 'refused';
    return { ok: false, reason };
  },
};

/** Twilio — not Indian, but the easiest to get a working test account on. */
const twilio: SmsProviderProfile = {
  id: 'twilio',
  buildRequest: (message, config) => ({
    url:
      config.url ||
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid ?? ''}/Messages.json`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Basic auth: account SID as the user, auth token as the password.
      authorization: `Basic ${Buffer.from(`${config.accountSid ?? ''}:${config.apiKey}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      To: `+${withCountryCode(message.mobile)}`,
      From: config.senderId,
      Body: message.body,
    }).toString(),
  }),
  accepted: (body) => {
    const json = parse(body);
    const sid = json['sid'];
    // Twilio is one of the few that uses status codes honestly, but it also returns a
    // `status` worth checking: `failed` and `undelivered` can arrive on a 2xx.
    const status = typeof json['status'] === 'string' ? (json['status'] as string) : '';
    if (status === 'failed' || status === 'undelivered') {
      return { ok: false, reason: status };
    }
    return typeof sid === 'string' ? { ok: true, reference: sid } : { ok: true };
  },
};

/** Fast2SMS — cheap, widely used for OTP in India, and returns failures with a 200. */
const fast2sms: SmsProviderProfile = {
  id: 'fast2sms',
  defaultUrl: 'https://www.fast2sms.com/dev/bulkV2',
  buildRequest: (message, config) => ({
    url: config.url,
    headers: { 'content-type': 'application/json', authorization: config.apiKey },
    body: JSON.stringify({
      route: 'dlt',
      sender_id: config.senderId,
      message: config.templateId,
      variables_values: extractCode(message.body),
      numbers: message.mobile,
    }),
  }),
  accepted: (body) => {
    const json = parse(body);
    if (json['return'] === true) {
      const requests = json['request_id'];
      return { ok: true, ...(typeof requests === 'string' ? { reference: requests } : {}) };
    }
    const reason = typeof json['message'] === 'string' ? (json['message'] as string) : 'refused';
    return { ok: false, reason };
  },
};

/**
 * Anything else: a JSON POST with the key in a configurable header.
 *
 * Optimistic about the response, because it cannot know the provider's success shape — and
 * says so. A hospital using this should move to a named profile once they know which
 * gateway they have, or their first silent non-delivery will be a patient at a kiosk.
 */
const generic: SmsProviderProfile = {
  id: 'generic',
  buildRequest: (message, config) => ({
    url: config.url,
    headers: { 'content-type': 'application/json', authorization: config.apiKey },
    body: JSON.stringify({
      mobiles: withCountryCode(message.mobile),
      sender: config.senderId,
      template_id: config.templateId,
      message: message.body,
    }),
  }),
  accepted: () => ({ ok: true }),
};

/**
 * The six digits out of the message.
 *
 * Template-based providers want the variable, not the sentence: the sentence is registered
 * with the operator and substituted at their end. Pulling the code back out of the body is
 * uglier than threading it through, but it keeps one message shape for the sandbox adapter
 * and the real ones, so what a developer reads in the log is what a patient receives.
 */
function extractCode(body: string): string {
  return /(\d{6})/.exec(body)?.[1] ?? '';
}

export const SMS_PROVIDERS: Record<string, SmsProviderProfile> = {
  msg91,
  twilio,
  fast2sms,
  generic,
};
