import { z } from 'zod';

/**
 * Environment contract for the core API.
 *
 * Validated once at boot: the process refuses to start on a bad or missing value
 * rather than failing later mid-journey. No hospital id, URL, key or clinical rule
 * is ever hard-coded in source — everything a deployment varies lives here.
 */
/**
 * A boolean from an environment variable, read the way a person writing one means it.
 *
 * NOT `z.coerce.boolean()`, which is `Boolean(value)` — and `Boolean('false')` is `true`.
 * Every `FEATURE_X=false` in every .env file this project has ever had evaluated to
 * ENABLED, silently, including the ones written specifically to turn a feature off. A
 * hospital disabling ABHA in its configuration would have got ABHA.
 *
 * Accepts the spellings people actually write, and refuses anything else rather than
 * guessing: an unparseable value is a typo, and defaulting a typo to either answer is how
 * a feature ends up in front of patients by accident.
 */
const envBoolean = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'boolean') return value;
  const normalised = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalised)) return false;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `expected a boolean like true/false, got "${value}"`,
  });
  return z.NEVER;
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /** Postgres connection string. Phase 2 consumes this. */
  DATABASE_URL: z.string().url().optional(),
  /** Redis connection string for BullMQ jobs and the integration outbox. */
  REDIS_URL: z.string().url().optional(),

  /** Object storage for original documents. */
  OBJECT_STORE_ENDPOINT: z.string().url().optional(),
  OBJECT_STORE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORE_ADAPTER: z.enum(['local', 'supabase', 'unconfigured']).default('local'),
  OBJECT_STORE_LOCAL_ROOT: z.string().min(1).optional(),

  /**
   * Supabase project, when it hosts the database, the object store, or both.
   *
   * The service-role key bypasses row-level security by design — it is the backend's key,
   * not a client's, and must never reach a browser or a kiosk. Nothing in this repository
   * sends it anywhere except to Supabase itself.
   */
  /**
   * CA bundle for a provider that signs with its own root. See `infra/certs/README.md`;
   * the alternative is turning verification off, which leaves the connection encrypted
   * and unauthenticated.
   */
  DB_CA_CERT_PATH: z.string().min(1).optional(),
  /** Overrides the TLS decision, which is otherwise made from the database host. */
  DB_SSL: envBoolean.optional(),
  /**
   * Pool size. Modest by default because managed Postgres counts connections: Supabase's
   * smaller plans allow few direct ones, and two API nodes at ten each will exhaust them.
   */
  DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /**
   * The PUBLIC key, and the only one the OTP transport may hold. The service-role key
   * bypasses row-level security; the auth endpoints do not need it, so they do not get it.
   */
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  /** Must be PRIVATE. Checked at boot rather than trusted; see SupabaseObjectStore. */
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('medikiosk-documents'),
  /**
   * Documents are encrypted by the application before they reach the object store, so a
   * storage administrator holds ciphertext.
   */
  OBJECT_ENCRYPTION_KEY: z.string().min(32).optional(),
  OBJECT_ENCRYPTION_KEY_ID: z.string().min(1).default('dev'),
  /**
   * Malware scanning. Anything other than a configured scanner fails CLOSED — an
   * unscanned upload accepted "just this once" is how a hospital becomes a malware
   * distribution point with a waiting room.
   */
  MALWARE_SCANNER: z.enum(['heuristic', 'unconfigured']).default('unconfigured'),

  /**
   * SMS gateway. `sandbox` logs the message instead of sending it, which is why
   * assertProductionAdapters() refuses it in production — a production log holding live
   * one-time codes would be a credential store in disguise.
   */
  SMS_ADAPTER: z.enum(['sandbox', 'http', 'unconfigured']).default('sandbox'),

  /**
   * Which gateway's dialect to speak. Each has a different request shape AND a different
   * way of reporting failure — most return HTTP 200 with an error in the body, so the
   * profile has to read it. `generic` is optimistic about the response and should be
   * replaced with a named provider before a hospital relies on it.
   */
  SMS_PROVIDER: z.enum(['msg91', 'twilio', 'fast2sms', 'generic']).default('msg91'),
  /** Twilio only: the account SID. */
  SMS_ACCOUNT_SID: z.string().min(1).optional(),
  /** Gateway endpoint. Optional for providers with a fixed one. */
  SMS_API_URL: z.string().url().optional(),
  SMS_API_KEY: z.string().min(8).optional(),
  /** `Authorization` for most gateways; `authkey` for MSG91. */
  SMS_AUTH_HEADER: z.string().min(1).default('Authorization'),
  /**
   * Registered sender ID — six alphabetic characters in India. An unregistered header is
   * dropped by the operator rather than the gateway, so the send "succeeds" and nothing
   * arrives.
   */
  SMS_SENDER_ID: z.string().min(1).optional(),
  /** DLT template id. India requires transactional SMS to match a registered template. */
  SMS_DLT_TEMPLATE_ID: z.string().min(1).optional(),
  /** A patient is waiting at the kiosk; a slower gateway than this has already failed. */
  SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

  /**
   * Who generates, sends and checks the one-time code.
   *
   * `local` keeps the whole mechanism here: the code is generated with a CSPRNG, stored as
   * an HMAC, and sent through SMS_ADAPTER. `supabase` delegates all three to Supabase Auth
   * and stores no hash at all.
   *
   * What stays ours either way: the send-rate limit, the attempt ceiling, the audit trail,
   * and the property that the response is identical for a registered and an unregistered
   * number. Those are the parts a hospital answers for, so they do not move.
   */
  OTP_PROVIDER: z.enum(['local', 'supabase']).default('local'),

  /** HMAC key for one-time codes. Codes are never stored in plaintext. */
  OTP_HMAC_SECRET: z.string().min(32).optional(),
  /** Names the key in use, so the secret can be rotated without invalidating live codes. */
  OTP_KEY_ID: z.string().min(1).default('dev'),

  /**
   * Shared key for the operations endpoints. Placeholder until Phase 15 brings staff SSO;
   * with no key configured the endpoints refuse rather than defaulting open.
   */
  OPS_API_KEY: z.string().min(24).optional(),

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
  /**
   * Browser origins allowed to call this API, comma separated.
   *
   * Empty means none, which is correct for a deployment where the only clients are the
   * kiosk (a native app, not subject to CORS) and server-side callers. The doctor and
   * governance consoles are browser applications on their own origins and must be listed.
   */
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  /** Signs short-lived document links for the doctor dashboard. */
  DOCUMENT_LINK_KEY: z.string().min(32).optional(),
  /** Which staff identity provider to use. Anything else means nobody can sign in. */
  STAFF_IDP: z.enum(['sandbox', 'supabase', 'none']).default('none'),
  /**
   * Supabase project JWT secret, when STAFF_IDP=supabase. Project Settings → API → JWT
   * Settings. Verifying locally means a flaky uplink cannot lock a doctor out of the
   * worklist, and it is the same secret Supabase signs access tokens with.
   */
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  /** Which EMR export adapter to use. Anything else exports nothing. */
  EMR_EXPORT_ADAPTER: z.enum(['sandbox', 'none']).default('none'),

  /**
   * Where `services/ai_worker` is listening, when one is running.
   *
   * Unset — the default — means the draft generator composes locally and never leaves the
   * process. That is not a degraded mode: the local path is checked by the same safety
   * validator and is what every deployment without an AI worker reads.
   *
   * Setting it does not bypass anything. The worker returns a *candidate*; it still has to
   * parse as a draft and still has to pass the safety gate, and a response that fails
   * either is discarded in favour of the local composition.
   */
  AI_WORKER_URL: z.string().url().optional(),
  /**
   * A patient is standing at the kiosk waiting for their token. The deterministic composer
   * produces a complete draft instantly, so there is no version of this worth waiting on:
   * past this, the local composition is strictly the better answer.
   */
  AI_WORKER_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  FEATURE_ABHA: envBoolean.default(false),
  FEATURE_AI_SUMMARY: envBoolean.default(false),
  FEATURE_OCR: envBoolean.default(false),
  FEATURE_RED_FLAGS: envBoolean.default(false),
  FEATURE_VOICE_INTAKE: envBoolean.default(false),
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
  // The SMS gateway exists only to carry one-time codes. With OTP_PROVIDER=supabase
  // nothing in this service sends a message, so requiring a configured gateway would
  // block a correct deployment on credentials it will never use.
  if (env.OTP_PROVIDER === 'local' && env.SMS_ADAPTER === 'sandbox') {
    problems.push(
      'SMS_ADAPTER=sandbox writes one-time codes to the log and cannot run in production',
    );
  }
  if (env.OTP_PROVIDER === 'local' && env.SMS_ADAPTER === 'http') {
    // Every one of these is required for a message to actually arrive in India. Missing
    // any of them produces a send that the gateway accepts and the operator discards,
    // which is the worst failure available: nobody is told, and the patient waits.
    for (const [name, value] of [
      ['SMS_API_KEY', env.SMS_API_KEY],
      ['SMS_SENDER_ID', env.SMS_SENDER_ID],
      ['SMS_DLT_TEMPLATE_ID', env.SMS_DLT_TEMPLATE_ID],
    ] as const) {
      if (!value) problems.push(`${name} is required when SMS_ADAPTER=http`);
    }
    // Only the generic profile needs a URL; the named ones have fixed endpoints.
    if (env.SMS_PROVIDER === 'generic' && !env.SMS_API_URL) {
      problems.push('SMS_API_URL is required when SMS_PROVIDER=generic');
    }
    if (env.SMS_PROVIDER === 'twilio' && !env.SMS_ACCOUNT_SID) {
      problems.push('SMS_ACCOUNT_SID is required when SMS_PROVIDER=twilio');
    }
  }
  if (env.OTP_PROVIDER === 'local' && !env.OTP_HMAC_SECRET) {
    problems.push('OTP_HMAC_SECRET is required in production');
  }
  if (env.OTP_PROVIDER === 'supabase') {
    if (!env.SUPABASE_URL) problems.push('SUPABASE_URL is required when OTP_PROVIDER=supabase');
    if (!env.SUPABASE_ANON_KEY) {
      problems.push('SUPABASE_ANON_KEY is required when OTP_PROVIDER=supabase');
    }
  }
  if (!env.QR_SIGNING_KEY) {
    problems.push('QR_SIGNING_KEY is required in production');
  }
  if (!env.OBJECT_ENCRYPTION_KEY) {
    problems.push('OBJECT_ENCRYPTION_KEY is required in production');
  }
  if (env.MALWARE_SCANNER !== 'unconfigured' && env.MALWARE_SCANNER === 'heuristic') {
    problems.push(
      'MALWARE_SCANNER=heuristic is not antivirus and cannot run in production; ' +
        'configure a real scanner such as ClamAV',
    );
  }
  if (env.OBJECT_STORE_ADAPTER === 'supabase') {
    if (!env.SUPABASE_URL)
      problems.push('SUPABASE_URL is required when OBJECT_STORE_ADAPTER=supabase');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      problems.push('SUPABASE_SERVICE_ROLE_KEY is required when OBJECT_STORE_ADAPTER=supabase');
    }
  }
  if (env.OBJECT_STORE_ADAPTER === 'local') {
    problems.push(
      'OBJECT_STORE_ADAPTER=local writes to the container filesystem and cannot run in production',
    );
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
