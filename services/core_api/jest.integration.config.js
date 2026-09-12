/**
 * Integration tests run against a REAL PostgreSQL instance, not a mock or an in-memory
 * emulation. The properties under test — atomic nonce consumption, unique idempotency
 * keys, serializable isolation, append-only audit rules — are properties of PostgreSQL
 * itself, so testing them against a substitute would prove nothing.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.int-spec\\.ts$',
  setupFilesAfterEnv: ['<rootDir>/test/setup-integration.ts'],
  moduleNameMapper: {
    '^@medikiosk/api-contracts$': '<rootDir>/../../packages/api_contracts/src/index.ts',
    '^@medikiosk/terminology$': '<rootDir>/../../packages/terminology/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  testTimeout: 30_000,
};
