import { describe, expect, it } from 'vitest';
import { evaluateReadiness, PRODUCTION_CHECKLIST } from './production-readiness';

describe('production readiness', () => {
  const verdict = evaluateReadiness();

  it('does not claim readiness', () => {
    // The specification says "Do not claim production readiness until…". This is the
    // check that keeps that true when somebody is in a hurry.
    expect(verdict.ready).toBe(false);
  });

  it('names every blocker rather than reporting a score', () => {
    expect(verdict.blockers.length).toBeGreaterThan(0);
    for (const blocker of verdict.blockers) {
      // A blocker with a one-line reason tells a hospital nothing about what to do.
      expect(blocker.evidence.length).toBeGreaterThan(80);
    }
  });

  it('covers all sixteen criteria the specification lists', () => {
    expect(PRODUCTION_CHECKLIST).toHaveLength(16);
  });

  it('gives every criterion evidence, not just a verdict', () => {
    for (const item of PRODUCTION_CHECKLIST) {
      expect(item.evidence.length, `${item.criterion} has no evidence`).toBeGreaterThan(60);
      if (item.kind === 'automated') {
        expect(typeof item.satisfied, `${item.criterion} is unresolved`).toBe('boolean');
      }
    }
  });

  it('keeps the organisational blockers organisational', () => {
    // Three things no repository can satisfy: a practitioner approving clinical content, a
    // hospital's privacy review, and a completed pilot. If one of these is ever marked
    // automated, somebody has redefined the criterion rather than met it.
    const organisational = PRODUCTION_CHECKLIST.filter((i) => i.kind === 'organisational');
    expect(organisational.map((i) => i.criterion)).toEqual([
      'Clinical governance has approved live content',
      'Hospital privacy and legal review is complete',
      'Pilot acceptance metrics are met',
    ]);
  });

  it('reports the automated criteria that are genuinely proven', () => {
    expect(verdict.automatedPassing).toBe(verdict.automatedTotal);
    expect(verdict.automatedTotal).toBe(10);
  });
});
