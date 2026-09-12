import { maskName, maskTail, redact, REDACTED } from './redact';

describe('log redaction', () => {
  it('masks a mobile number to its last four digits', () => {
    expect(maskTail('9876543210')).toBe('******3210');
  });

  it('masks a name to initials, matching the kiosk confirmation screen', () => {
    expect(maskName('Ravi Kumar')).toBe('R*** K****');
  });

  it('never leaks an OTP', () => {
    expect(redact({ otp: '123456' })).toEqual({ otp: REDACTED });
    expect(redact({ otpCode: '123456' })).toEqual({ otpCode: REDACTED });
    expect(redact({ otp_code: '123456' })).toEqual({ otp_code: REDACTED });
  });

  it('never leaks a QR signature or nonce', () => {
    expect(redact({ signature: 'abc', nonce: 'def' })).toEqual({
      signature: REDACTED,
      nonce: REDACTED,
    });
  });

  it('never leaks a clinical narrative or transcript', () => {
    const input = { transcript: 'patient reports knee pain', narrative: 'long text' };
    expect(redact(input)).toEqual({ transcript: REDACTED, narrative: REDACTED });
  });

  it('masks identifiers instead of dropping them, so support can still correlate', () => {
    expect(redact({ uhid: 'UH00012345', mobile: '9876543210' })).toEqual({
      uhid: '******2345',
      mobile: '******3210',
    });
  });

  it('masks an email to its first character and domain', () => {
    expect(redact({ email: 'ravi@example.org' })).toEqual({ email: 'r***@example.org' });
  });

  it('redacts recursively through nested objects and arrays', () => {
    const input = { patients: [{ name: 'Ravi Kumar', otp: '999999' }] };
    expect(redact(input)).toEqual({ patients: [{ name: 'R*** K****', otp: REDACTED }] });
  });

  it('stops at a depth limit rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain(REDACTED);
  });

  it('leaves non-sensitive scalars untouched', () => {
    expect(redact({ hospitalId: 'HOSP-001', attempt: 2, ok: true })).toEqual({
      hospitalId: 'HOSP-001',
      attempt: 2,
      ok: true,
    });
  });
});
