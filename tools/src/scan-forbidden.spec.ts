import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FORBIDDEN_OPTIONS } from './forbidden-options';
import { scanContent, scanRepository } from './scan-forbidden';

describe('forbidden-option scan', () => {
  it('flags every banned phrase', () => {
    for (const phrase of FORBIDDEN_OPTIONS) {
      const hits = scanContent('fake.dart', `Text('${phrase}')`);
      expect(hits.map((h) => h.phrase)).toContain(phrase);
    }
  });

  it('is case-insensitive — shouting a banned option is still banned', () => {
    expect(scanContent('fake.dart', "Text('ENTER TOKEN')")).toHaveLength(1);
    expect(scanContent('fake.dart', "Text('generate new qr')")).toHaveLength(1);
  });

  it('reports the line number and an excerpt so the violation is findable', () => {
    const content = ['line one', 'line two', "  Text('Urgent Help'),"].join('\n');
    const [hit] = scanContent('lib/home.dart', content);
    expect(hit?.line).toBe(3);
    expect(hit?.file).toBe('lib/home.dart');
    expect(hit?.excerpt).toContain('Urgent Help');
  });

  it('honours an explicit allow marker so the guard can describe what it bans', () => {
    const content = "// never render 'Enter token' // forbidden-option-scan:allow";
    expect(scanContent('lib/notes.dart', content)).toHaveLength(0);
  });

  it('does not flag innocent text that merely shares words', () => {
    const content = [
      "Text('Enter your registered mobile number')",
      "Text('Scan appointment QR')",
      "Text('Help')",
    ].join('\n');
    expect(scanContent('lib/identity.dart', content)).toHaveLength(0);
  });

  it('tolerates a scanned root that does not exist yet', () => {
    const hits = scanRepository(resolve(__dirname, '../..'), ['apps/not_built_yet/src']);
    expect(hits).toEqual([]);
  });

  it('finds no violation anywhere in the current repository', () => {
    expect(scanRepository(resolve(__dirname, '../..'))).toEqual([]);
  });
});
