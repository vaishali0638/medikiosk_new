import { assertProductionAdapters, loadEnv } from './env';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/medikiosk',
  HIS_BASE_URL: 'https://his.example.org',
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
