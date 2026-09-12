/**
 * Log redaction.
 *
 * The build prompt forbids logging OTPs, full identifiers, raw documents or complete
 * clinical narratives. Redaction is applied centrally rather than trusted to each call
 * site, because a single careless log line is a reportable privacy incident.
 */

/** Keys whose values are replaced wholesale wherever they appear. */
const FORBIDDEN_KEYS = new Set([
  'otp',
  'otpcode',
  'code',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'signature',
  'nonce',
  'aadhaar',
  'abha',
  'abhaaddress',
  'documentbytes',
  'filebytes',
  'transcript',
  'narrative',
  'clinicalnarrative',
  'summary',
]);

/** Keys that are masked rather than removed, so support staff can still correlate. */
const MASKED_KEYS = new Set([
  'mobile',
  'phone',
  'mobilenumber',
  'email',
  'uhid',
  'name',
  'address',
]);

export const REDACTED = '[REDACTED]';

/** Shows only the last 4 characters: `9876543210` -> `******3210`. */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
}

/** Shows only the first character of each word: `Ravi Kumar` -> `R**** K****`. */
export function maskName(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0] + '*'.repeat(Math.max(part.length - 1, 0)))
    .join(' ');
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return REDACTED;
  if (key === 'name') return maskName(value);
  if (key === 'email') {
    const at = value.indexOf('@');
    return at <= 0 ? REDACTED : `${value[0]}***${value.slice(at)}`;
  }
  return maskTail(value);
}

/**
 * Deep-redacts an object for logging. Unknown keys pass through, so this is a
 * safety net rather than a licence to log arbitrary payloads.
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));
  if (typeof input !== 'object') return input;
  if (input instanceof Date) return input.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalised = key.toLowerCase().replace(/[_-]/g, '');
    if (FORBIDDEN_KEYS.has(normalised)) {
      out[key] = REDACTED;
    } else if (MASKED_KEYS.has(normalised)) {
      out[key] = maskValue(normalised, value);
    } else {
      out[key] = redact(value, depth + 1);
    }
  }
  return out;
}
