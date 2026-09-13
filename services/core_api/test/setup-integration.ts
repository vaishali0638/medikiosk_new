import { tmpdir } from 'node:os';

/** Integration tests must never point at a real deployment. */
const url = process.env['DATABASE_URL'] ?? '';

if (!url) {
  throw new Error(
    'DATABASE_URL is required for integration tests, e.g.\n' +
      '  DATABASE_URL=postgres://localhost:5432/medikiosk_test npm run test:int -w @medikiosk/core-api',
  );
}
if (!/medikiosk_(test|ci)/.test(url)) {
  throw new Error('Integration tests only run against medikiosk_test or medikiosk_ci');
}

// The operations endpoints refuse when no key is configured, which is the intended
// production-safe default. Tests set one so the guard itself can be exercised.
process.env['OPS_API_KEY'] ??= 'integration-test-ops-key-0123456789';

// Adapter selection happens when ConfigModule.forRoot(...) is EVALUATED, which is at
// module-import time — before any beforeAll runs. Anything set later is ignored, and the
// app silently comes up with the fail-closed defaults. So it is set here, in the file
// Jest loads before the suite.
process.env['OBJECT_STORE_ADAPTER'] ??= 'local';
process.env['OBJECT_STORE_LOCAL_ROOT'] ??= `${tmpdir()}/medikiosk-test-objects`;
process.env['OBJECT_ENCRYPTION_KEY'] ??= 'c'.repeat(48);
process.env['MALWARE_SCANNER'] ??= 'heuristic';
