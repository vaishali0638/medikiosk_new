import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PILOT_COVERAGE } from './pilot-coverage';

/**
 * Checks the Phase 17 matrix against the tests that actually exist.
 *
 * Two failure modes it exists to prevent. A scenario the specification names with nothing
 * covering it and nobody having noticed — and a matrix that was true once, then drifted as
 * tests were renamed, which is worse than no matrix because it reads as assurance.
 */

const ROOT = resolve(__dirname, '../..');

/** Every test name declared anywhere in the repository. */
function allTestNames(): string[] {
  const patterns = [
    'services/core_api/test/*.int-spec.ts',
    'services/core_api/src/**/*.spec.ts',
    'packages/*/src/**/*.spec.ts',
    'apps/kiosk_flutter/test/*.dart',
    'tools/src/*.spec.ts',
  ];

  const names: string[] = [];
  for (const pattern of patterns) {
    for (const file of globSync(pattern, { cwd: ROOT })) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      // `it(`, `test(` and Dart's `testWidgets(` / `test(`, single or double quoted.
      for (const match of source.matchAll(/(?:it|test|testWidgets)\(\s*(['"])(.*?)\1/gs)) {
        names.push(match[2] as string);
      }
    }
  }
  return names;
}

describe('Phase 17 pilot coverage', () => {
  const names = allTestNames();

  it('can see the test suites at all', () => {
    // Without this, a broken glob makes every assertion below pass vacuously and the
    // matrix silently stops checking anything.
    expect(names.length).toBeGreaterThan(400);
  });

  it('every scenario is either covered or declares why not', () => {
    for (const group of PILOT_COVERAGE) {
      for (const scenario of group.scenarios) {
        const declared = scenario.covers !== undefined || scenario.gap !== undefined;
        expect(declared, `${group.group} / ${scenario.scenario} says nothing`).toBe(true);

        if (scenario.gap !== undefined) {
          // A gap has to be argued, not asserted. One line saying "not done" tells the
          // next reader nothing about whether it can be done.
          expect(
            scenario.gap.length,
            `${group.group} / ${scenario.scenario} gives no real reason`,
          ).toBeGreaterThan(60);
        }
      }
    }
  });

  it('every claimed test actually exists', () => {
    const missing: string[] = [];

    for (const group of PILOT_COVERAGE) {
      for (const scenario of group.scenarios) {
        for (const fragment of scenario.covers ?? []) {
          if (!names.some((name) => name.includes(fragment))) {
            missing.push(`${group.group} / ${scenario.scenario} → "${fragment}"`);
          }
        }
      }
    }

    expect(missing, `no test matches:\n${missing.join('\n')}`).toEqual([]);
  });

  it('covers every scenario the specification names', () => {
    const total = PILOT_COVERAGE.reduce((sum, g) => sum + g.scenarios.length, 0);
    const gaps = PILOT_COVERAGE.flatMap((g) => g.scenarios.filter((s) => s.gap !== undefined));

    // The three that remain are the ones needing a real OPD, real hardware, or clinical
    // content nobody has authored. If that number falls, good; if it rises, somebody has
    // given up on a scenario and should have to change this line to do it.
    expect(total).toBeGreaterThanOrEqual(45);
    expect(gaps).toHaveLength(3);
  });
});
