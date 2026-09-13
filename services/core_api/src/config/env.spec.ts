import { assertProductionAdapters, loadEnv } from './env';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/medikiosk',
  HIS_BASE_URL: 'https://his.example.org',
  SMS_ADAPTER: 'unconfigured',
  OTP_HMAC_SECRET: 'a'.repeat(48),
  QR_SIGNING_KEY: '-----BEGIN PRIVATE KEY-----\nnot-parsed-by-loadEnv\n-----END PRIVATE KEY-----',
  OBJECT_ENCRYPTION_KEY: 'o'.repeat(48),
  OBJECT_STORE_ADAPTER: 'unconfigured',
};

describe('environment configuration', () => {
  it('applies safe defaults in development', () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.HIS_ADAPTER).toBe('sandbox');
  });

  it('defaults every feature flag to off', () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.FEATURE_ABHA).toBe(false);
    expect(env.FEATURE_AI_SUMMARY).toBe(false);
    expect(env.FEATURE_OCR).toBe(false);
    expect(env.FEATURE_RED_FLAGS).toBe(false);
    expect(env.FEATURE_VOICE_INTAKE).toBe(false);
  });

  it('rejects a malformed port rather than silently coercing it', () => {
    expect(() => loadEnv({ PORT: 'not-a-port' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects an unknown HIS adapter', () => {
    expect(() => loadEnv({ HIS_ADAPTER: 'guesswork' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('refuses to run the sandbox HIS adapter in production', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'sandbox',
    } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).toThrow(/sandbox/);
  });

  it('requires a HIS base URL and database URL in production', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
    } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).toThrow(/HIS_BASE_URL/);
    expect(() => assertProductionAdapters(env)).toThrow(/DATABASE_URL/);
  });

  it('refuses to write one-time codes to the log in production', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
      SMS_ADAPTER: 'sandbox',
    } as unknown as NodeJS.ProcessEnv);
    // A production log holding live one-time codes is a credential store in disguise.
    expect(() => assertProductionAdapters(env)).toThrow(/SMS_ADAPTER=sandbox/);
  });

  it('requires an OTP signing secret in production', () => {
    const env = loadEnv({
      DATABASE_URL: baseEnv.DATABASE_URL,
      HIS_BASE_URL: baseEnv.HIS_BASE_URL,
      SMS_ADAPTER: 'unconfigured',
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
    } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).toThrow(/OTP_HMAC_SECRET/);
  });

  it('rejects a weak OTP secret', () => {
    expect(() => loadEnv({ OTP_HMAC_SECRET: 'too-short' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('requires a QR signing key in production', () => {
    const env = loadEnv({
      DATABASE_URL: baseEnv.DATABASE_URL,
      HIS_BASE_URL: baseEnv.HIS_BASE_URL,
      SMS_ADAPTER: 'unconfigured',
      OTP_HMAC_SECRET: baseEnv.OTP_HMAC_SECRET,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
    } as unknown as NodeJS.ProcessEnv);
    // Without it the service would fall back to an ephemeral key, and every QR issued
    // before a restart would stop verifying mid-session.
    expect(() => assertProductionAdapters(env)).toThrow(/QR_SIGNING_KEY/);
  });

  it('refuses to store documents on the container filesystem in production', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
      OBJECT_STORE_ADAPTER: 'local',
    } as unknown as NodeJS.ProcessEnv);
    // A deployment that thinks it is writing to durable storage and is not would lose
    // every document on the next restart, silently.
    expect(() => assertProductionAdapters(env)).toThrow(/OBJECT_STORE_ADAPTER=local/);
  });

  it('requires a document encryption key in production', () => {
    const env = loadEnv({
      DATABASE_URL: baseEnv.DATABASE_URL,
      HIS_BASE_URL: baseEnv.HIS_BASE_URL,
      SMS_ADAPTER: 'unconfigured',
      OTP_HMAC_SECRET: baseEnv.OTP_HMAC_SECRET,
      QR_SIGNING_KEY: baseEnv.QR_SIGNING_KEY,
      OBJECT_STORE_ADAPTER: 'unconfigured',
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
    } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).toThrow(/OBJECT_ENCRYPTION_KEY/);
  });

  it('refuses the heuristic malware scanner in production', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'rest',
      MALWARE_SCANNER: 'heuristic',
    } as unknown as NodeJS.ProcessEnv);
    // It is not antivirus, and a hospital accepting uploads without one is a malware
    // distribution point with a waiting room.
    expect(() => assertProductionAdapters(env)).toThrow(/MALWARE_SCANNER=heuristic/);
  });

  it('accepts a fully configured production environment', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      HIS_ADAPTER: 'fhir',
    } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).not.toThrow();
  });

  it('does not gate non-production environments', () => {
    const env = loadEnv({ NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv);
    expect(() => assertProductionAdapters(env)).not.toThrow();
  });
});
