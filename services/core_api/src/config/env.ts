import { z } from 'zod';

/**
 * Environment contract for the core API.
 *
 * Validated once at boot: the process refuses to start on a bad or missing value
 * rather than failing later mid-journey. No hospital id, URL, key or clinical rule
 * is ever hard-coded in source — everything a deployment varies lives here.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /** Postgres connection string. Phase 2 consumes this. */
  DATABASE_URL: z.string().url().optional(),
  /** Redis connection string for BullMQ jobs and the integration outbox. */
  REDIS_URL: z.string().url().optional(),

  /** Object storage for original documents. Phase 10 consumes these. */
  OBJECT_STORE_ENDPOINT: z.string().url().optional(),
  OBJECT_STORE_BUCKET: z.string().min(1).optional(),

  /**
   * SMS gateway. `sandbox` logs the message instead of sending it, which is why
   * assertProductionAdapters() refuses it in production — a production log holding live
   * one-time codes would be a credential store in disguise.
   */
  SMS_ADAPTER: z.enum(['sandbox', 'unconfigured']).default('sandbox'),

  /** HMAC key for one-time codes. Codes are never stored in plaintext. */
  OTP_HMAC_SECRET: z.string().min(32).optional(),
  /** Names the key in use, so the secret can be rotated without invalidating live codes. */
  OTP_KEY_ID: z.string().min(1).default('dev'),

  /**
   * Ed25519 private key (PKCS8 PEM) that signs pre-check-in QR codes. Without it a
   * development build generates an ephemeral key and says so; production refuses to boot.
   */
  QR_SIGNING_KEY: z.string().min(1).optional(),
  QR_SIGNING_KEY_ID: z.string().min(1).default('dev'),
  /**
   * Public keys retired by a rotation, still accepted for verification so codes already
   * on a patient's screen keep working. Blank-line-separated `<keyId>:<spki pem>` entries.
   */
  QR_RETIRED_PUBLIC_KEYS: z.string().optional(),

  /**
   * Which HIS adapter to use. `sandbox` is a local development stand-in and is
   * rejected in production by assertProductionAdapters() below.
   */
  HIS_ADAPTER: z.enum(['sandbox', 'rest', 'fhir', 'hl7v2']).default('sandbox'),
  HIS_BASE_URL: z.string().url().optional(),

  /**
   * Feature flags. Everything not yet built is off, and a disabled feature must not
   * render in any UI — the kiosk reads these through /v1/kiosk/config.
   */
  FEATURE_ABHA: z.coerce.boolean().default(false),
  FEATURE_AI_SUMMARY: z.coerce.boolean().default(false),
  FEATURE_OCR: z.coerce.boolean().default(false),
  FEATURE_RED_FLAGS: z.coerce.boolean().default(false),
  FEATURE_VOICE_INTAKE: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Safety gate: a sandbox adapter must never serve real patients. Production
 * deployments have to name a real HIS adapter and its base URL.
 */
export function assertProductionAdapters(env: Env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (env.HIS_ADAPTER === 'sandbox') {
    problems.push('HIS_ADAPTER=sandbox is a development stand-in and cannot run in production');
  }
  if (env.SMS_ADAPTER === 'sandbox') {
    problems.push(
      'SMS_ADAPTER=sandbox writes one-time codes to the log and cannot run in production',
    );
  }
  if (!env.OTP_HMAC_SECRET) {
    problems.push('OTP_HMAC_SECRET is required in production');
  }
  if (!env.QR_SIGNING_KEY) {
    problems.push('QR_SIGNING_KEY is required in production');
  }
  if (!env.HIS_BASE_URL) {
    problems.push('HIS_BASE_URL is required in production');
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is required in production');
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
