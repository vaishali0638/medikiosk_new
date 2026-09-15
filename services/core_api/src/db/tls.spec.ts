import { requiresTls } from './db.module';

describe('requiresTls', () => {
  it('leaves a local database in the clear', () => {
    expect(requiresTls('postgres://localhost:5432/medikiosk_dev')).toBe(false);
    expect(requiresTls('postgres://127.0.0.1:5432/medikiosk_dev')).toBe(false);
  });

  it('requires TLS for anything remote', () => {
    // The case this exists for. It used to depend on NODE_ENV, so a developer pointing at
    // a hosted database got a plaintext attempt the server refused, with an error that
    // never mentioned TLS.
    expect(requiresTls('postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toBe(true);
    expect(requiresTls('postgres://user:pw@10.0.0.5:5432/medikiosk')).toBe(true);
  });

  it('defaults to TLS when the URL cannot be parsed', () => {
    // An unparseable URL is not a licence to send credentials in the clear.
    expect(requiresTls('not a url at all')).toBe(true);
  });

  it('lets an explicit setting win in both directions', () => {
    expect(requiresTls('postgres://db.example.com:5432/x', false)).toBe(false);
    expect(requiresTls('postgres://localhost:5432/x', true)).toBe(true);
  });
});
