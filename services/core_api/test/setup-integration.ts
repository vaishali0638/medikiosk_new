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
