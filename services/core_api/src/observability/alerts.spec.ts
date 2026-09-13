import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every alert must have a runbook section, and every section must belong to an alert.
 *
 * The `runbook` field on an alert is required by its type, so an alert cannot be added
 * without naming a document — but nothing stopped that document from being missing, or the
 * section within it from never having been written. This closes that: adding an alert
 * without instructions fails here, at build time, rather than at 2am.
 */
describe('alert runbooks', () => {
  const source = readFileSync(resolve(__dirname, 'alerts.service.ts'), 'utf8');
  const runbook = readFileSync(resolve(__dirname, '../../../../docs/runbooks/alerts.md'), 'utf8');

  const alertNames = [...source.matchAll(/name: '([A-Za-z]+)',\n\s+severity:/g)].map(
    (m) => m[1] as string,
  );
  const sections = [...runbook.matchAll(/^## (.+)$/gm)].map((m) => (m[1] as string).trim());

  it('finds the alerts defined in the service', () => {
    // Guards the regex above: if it stops matching, every other assertion here passes
    // vacuously and the check silently stops working.
    expect(alertNames.length).toBeGreaterThanOrEqual(8);
  });

  it('has a runbook section for every alert', () => {
    for (const name of alertNames) {
      const anchored = sections.some((s) => s === name);
      const referenced = runbook.includes(`#${name.toLowerCase()}`);
      expect(anchored || referenced).toBe(true);
    }
  });

  it('has no runbook section for an alert that no longer exists', () => {
    // A section for a deleted alert is worse than none: it tells whoever is on call that a
    // condition is handled when nothing raises it any more.
    for (const section of sections) {
      expect(alertNames).toContain(section);
    }
  });

  it('gives every section something to do, not just a description', () => {
    for (const section of sections) {
      const body = runbook.split(`## ${section}`)[1]?.split('\n## ')[0] ?? '';

      // Either numbered steps, or a pointer to the runbook that has them. Prose alone is a
      // description of the problem, which is what the recipient already has.
      const hasSteps = /^1\. /m.test(body);
      const delegated = body.match(/docs\/runbooks\/([a-z-]+\.md)/);

      if (delegated) {
        // And the file it points at must exist, or the delegation is a dead end.
        const target = resolve(__dirname, '../../../../docs/runbooks', delegated[1] as string);
        expect(existsSync(target)).toBe(true);
      } else {
        expect(hasSteps).toBe(true);
      }
    }
  });
});
