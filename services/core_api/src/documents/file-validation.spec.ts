import {
  HeuristicMalwareScanner,
  MAX_BYTES,
  UnconfiguredMalwareScanner,
  sniffMatches,
  validateUpload,
} from './file-validation';

const jpeg = (extra: number[] = []): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...extra]);
const png = (): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const pdf = (body = ''): Buffer => Buffer.from(`%PDF-1.7\n${body}`, 'latin1');

describe('upload validation', () => {
  it('accepts the three supported types', () => {
    expect(validateUpload(jpeg(), 'image/jpeg')).toBeNull();
    expect(validateUpload(png(), 'image/png')).toBeNull();
    expect(validateUpload(pdf(), 'application/pdf')).toBeNull();
  });

  it('refuses an empty file', () => {
    expect(validateUpload(Buffer.alloc(0), 'image/jpeg')?.reason).toBe('EMPTY_FILE');
  });

  it('refuses a file over the size cap', () => {
    const huge = Buffer.alloc(MAX_BYTES + 1);
    expect(validateUpload(huge, 'image/jpeg')?.reason).toBe('FILE_TOO_LARGE');
  });

  it('refuses a type it does not accept', () => {
    expect(validateUpload(jpeg(), 'application/zip')?.reason).toBe('UNSUPPORTED_TYPE');
    expect(validateUpload(jpeg(), 'text/html')?.reason).toBe('UNSUPPORTED_TYPE');
  });
});

describe('magic-byte sniffing', () => {
  it('matches a real file to its declared type', () => {
    expect(sniffMatches(jpeg(), 'image/jpeg')).toBe(true);
    expect(sniffMatches(png(), 'image/png')).toBe(true);
    expect(sniffMatches(pdf(), 'application/pdf')).toBe(true);
  });

  it('catches a file lying about what it is', () => {
    // The declared content type is attacker-controlled.
    expect(sniffMatches(pdf(), 'image/jpeg')).toBe(false);
    expect(sniffMatches(Buffer.from('MZ\x90\x00'), 'application/pdf')).toBe(false);
  });
});

describe('HeuristicMalwareScanner', () => {
  const scanner = new HeuristicMalwareScanner();
  const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  it('passes a clean file', async () => {
    expect(await scanner.scan(jpeg(), 'image/jpeg')).toEqual({ clean: true });
  });

  it('detects the EICAR test signature', async () => {
    const infected = Buffer.concat([jpeg(), Buffer.from(EICAR, 'ascii')]);
    expect(await scanner.scan(infected, 'image/jpeg')).toEqual({
      clean: false,
      reason: 'EICAR_TEST_SIGNATURE',
    });
  });

  it('refuses a file whose bytes contradict its declared type', async () => {
    const result = await scanner.scan(pdf(), 'image/png');
    expect(result).toEqual({ clean: false, reason: 'CONTENT_TYPE_MISMATCH' });
  });

  it('refuses a PDF carrying JavaScript', async () => {
    // A prescription has no need for active content, and it is a well-worn delivery route.
    const result = await scanner.scan(pdf('/JavaScript (app.alert(1))'), 'application/pdf');
    expect(result.clean).toBe(false);
  });

  it('refuses a PDF with an embedded file or launch action', async () => {
    expect((await scanner.scan(pdf('/Launch'), 'application/pdf')).clean).toBe(false);
    expect((await scanner.scan(pdf('/EmbeddedFile'), 'application/pdf')).clean).toBe(false);
  });

  it('passes an ordinary PDF', async () => {
    expect(await scanner.scan(pdf('1 0 obj\n<< /Type /Catalog >>'), 'application/pdf')).toEqual({
      clean: true,
    });
  });
});

describe('UnconfiguredMalwareScanner', () => {
  it('fails closed on everything', async () => {
    // An unscanned upload accepted "just this once" is how a hospital becomes a malware
    // distribution point with a waiting room.
    const result = await new UnconfiguredMalwareScanner().scan();
    expect(result).toEqual({ clean: false, reason: 'NO_SCANNER_CONFIGURED' });
  });
});
