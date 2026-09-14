import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@medikiosk/terminology';
import { formatCoverage, loadCoverage, summarise } from './language-coverage';

describe('language coverage', () => {
  const coverage = loadCoverage();

  it('reports on every registered language, not only the translated ones', () => {
    // A report that listed only what exists would answer "which languages are done?" and
    // never "which are missing?", which is the question a hospital actually has.
    expect(coverage.map((c) => c.tag).sort()).toEqual(LANGUAGES.map((l) => l.tag).sort());
  });

  it('covers all twenty-two Eighth Schedule languages, plus English', () => {
    const summary = summarise(coverage);
    expect(summary.eighthSchedule).toBe(22);
    expect(summary.registered).toBe(23);
  });

  it('counts a translation complete only when every baseline key is present', () => {
    for (const entry of coverage) {
      if (entry.shellStatus === 'untranslated') {
        expect(entry.shellKeys).toBe(0);
        continue;
      }
      expect(entry.shellKeys).toBe(entry.baselineKeys);
    }
  });

  it('never reports a language as reviewed without a named reviewer', () => {
    // The downgrade happens in the loader, not on trust: a 'reviewed' status with a null
    // reviewer is reported as unreviewed, so the claim cannot be made by editing one word.
    for (const entry of coverage) {
      if (entry.shellStatus !== 'reviewed') continue;
      expect(entry.reviewer).not.toBeNull();
    }
  });

  it('reports the current, true state: translated but not yet reviewed', () => {
    const summary = summarise(coverage);
    expect(summary.shellComplete).toBeGreaterThanOrEqual(14);
    expect(summary.shellReviewed).toBe(0);
  });

  it('names the gates it cannot answer instead of implying it has', () => {
    const summary = summarise(coverage);
    expect(summary.notVisibleHere).toHaveLength(3);
    expect(summary.notVisibleHere.join(' ')).toMatch(/consent notice/i);
    expect(summary.notVisibleHere.join(' ')).toMatch(/voice installed/i);
  });

  it('flags the scripts with no font on a stock device', () => {
    const flagged = coverage.filter((c) => c.needsBundledFont).map((c) => c.tag);
    expect(flagged).toEqual(['mni', 'sat']);
  });

  it('marks the three right-to-left languages', () => {
    const rtl = coverage.filter((c) => c.direction === 'rtl').map((c) => c.tag);
    expect(rtl).toEqual(['ks', 'sd', 'ur']);
  });

  it('prints a report that states what it does not cover', () => {
    const report = formatCoverage(coverage);
    expect(report).toContain('Not answerable from this repository:');
    expect(report).toContain('Odia');
    expect(report).toContain('needs bundled font');
  });
});
