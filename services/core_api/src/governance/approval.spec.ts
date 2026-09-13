import { checkPublishable, type Approval, type PublishCandidate } from './approval';

const approval = (role: Approval['role'], by: string, qualification?: string): Approval => ({
  role,
  by,
  ...(qualification ? { qualification } : {}),
  at: '2026-09-13T10:00:00.000Z',
});

const candidate = (over: Partial<PublishCandidate> = {}): PublishCandidate => ({
  contentKind: 'AYUSH_MODULE',
  contentKey: 'ayurveda/en',
  version: '1.0.0',
  approvals: [
    approval('AUTHOR', 'Dr A Sharma', 'BAMS, MD (Ayurveda)'),
    approval('CLINICAL_REVIEWER', 'Dr B Nair', 'BAMS, PhD'),
    approval('TRANSLATION_REVIEWER', 'C Iyer'),
    approval('SAFETY_REVIEWER', 'Dr D Rao'),
  ],
  effectiveFrom: new Date('2026-09-14T00:00:00.000Z'),
  rollbackToId: '11111111-1111-4111-8111-111111111111',
  isFirstRelease: false,
  ...over,
});

describe('publishing an AYUSH module', () => {
  it('accepts a fully approved release', () => {
    expect(checkPublishable(candidate())).toEqual([]);
  });

  it('requires all four named roles', () => {
    for (const role of [
      'AUTHOR',
      'CLINICAL_REVIEWER',
      'TRANSLATION_REVIEWER',
      'SAFETY_REVIEWER',
    ] as const) {
      const without = candidate({
        approvals: candidate().approvals.filter((a) => a.role !== role),
      });
      expect(checkPublishable(without).join()).toContain(`missing approval from a ${role}`);
    }
  });

  it('refuses one person signing every role', () => {
    // Four roles held by one person is not four checks.
    const solo = candidate({
      approvals: [
        approval('AUTHOR', 'Dr A Sharma', 'BAMS'),
        approval('CLINICAL_REVIEWER', 'Dr A Sharma', 'BAMS'),
        approval('TRANSLATION_REVIEWER', 'Dr A Sharma'),
        approval('SAFETY_REVIEWER', 'Dr A Sharma'),
      ],
    });
    expect(checkPublishable(solo).join()).toMatch(/distinct approvers, found 1/);
  });

  it('treats the same person written differently as the same person', () => {
    const solo = candidate({
      approvals: [
        approval('AUTHOR', 'Dr A Sharma', 'BAMS'),
        approval('CLINICAL_REVIEWER', '  dr a sharma  ', 'BAMS'),
        approval('TRANSLATION_REVIEWER', 'Dr A Sharma'),
        approval('SAFETY_REVIEWER', 'DR A SHARMA'),
      ],
    });
    expect(checkPublishable(solo).join()).toMatch(/distinct approvers/);
  });

  it('requires the author to state a qualification', () => {
    // "Reviewed by a practitioner" means nothing without saying a practitioner of what.
    const vague = candidate({
      approvals: [
        approval('AUTHOR', 'Dr A Sharma'),
        approval('CLINICAL_REVIEWER', 'Dr B Nair', 'BAMS'),
        approval('TRANSLATION_REVIEWER', 'C Iyer'),
        approval('SAFETY_REVIEWER', 'Dr D Rao'),
      ],
    });
    expect(checkPublishable(vague).join()).toMatch(/AUTHOR must state their qualification/);
  });

  it('rejects a blank qualification as no qualification', () => {
    const blank = candidate({
      approvals: [
        approval('AUTHOR', 'Dr A Sharma', '   '),
        approval('CLINICAL_REVIEWER', 'Dr B Nair', 'BAMS'),
        approval('TRANSLATION_REVIEWER', 'C Iyer'),
        approval('SAFETY_REVIEWER', 'Dr D Rao'),
      ],
    });
    expect(checkPublishable(blank).join()).toMatch(/AUTHOR must state their qualification/);
  });

  it('requires an effective date', () => {
    expect(checkPublishable(candidate({ effectiveFrom: null })).join()).toMatch(
      /missing an effective date/,
    );
  });

  it('requires a rollback pointer on anything superseding a release', () => {
    // Without it, "roll back" becomes "find the previous version by hand, under pressure".
    expect(checkPublishable(candidate({ rollbackToId: null })).join()).toMatch(
      /missing a rollback pointer/,
    );
  });

  it('does not require a rollback pointer on the first release', () => {
    expect(checkPublishable(candidate({ rollbackToId: null, isFirstRelease: true }))).toEqual([]);
  });

  it('refuses to publish a pre-release version as live content', () => {
    // Content whose own version says it is unfinished cannot be live content.
    expect(checkPublishable(candidate({ version: '0.1.0-placeholder' })).join()).toMatch(
      /pre-release and cannot be published/,
    );
  });

  it('reports every problem at once', () => {
    // An author fixing one thing per review cycle is how a governance process gets
    // abandoned.
    const bad = candidate({
      approvals: [approval('AUTHOR', 'Dr A Sharma')],
      effectiveFrom: null,
      rollbackToId: null,
      version: '0.1.0-draft',
    });
    expect(checkPublishable(bad).length).toBeGreaterThan(4);
  });
});

describe('other governed content', () => {
  it('does not demand a translation reviewer on a red-flag rule', () => {
    const rule = candidate({
      contentKind: 'RED_FLAG_RULE',
      approvals: [
        approval('AUTHOR', 'Dr A Sharma'),
        approval('CLINICAL_REVIEWER', 'Dr B Nair', 'MBBS'),
        approval('SAFETY_REVIEWER', 'Dr D Rao'),
      ],
    });
    expect(checkPublishable(rule)).toEqual([]);
  });

  it('demands a safety reviewer on a red-flag rule', () => {
    // A rule that fires an internal alert is safety-critical by definition.
    const rule = candidate({
      contentKind: 'RED_FLAG_RULE',
      approvals: [
        approval('AUTHOR', 'Dr A Sharma'),
        approval('CLINICAL_REVIEWER', 'Dr B Nair', 'MBBS'),
      ],
    });
    expect(checkPublishable(rule).join()).toMatch(/missing approval from a SAFETY_REVIEWER/);
  });

  it('does not require a rollback pointer on a consent notice', () => {
    const notice = candidate({
      contentKind: 'CONSENT_NOTICE',
      rollbackToId: null,
      approvals: [
        approval('AUTHOR', 'Legal'),
        approval('CLINICAL_REVIEWER', 'Dr B Nair'),
        approval('TRANSLATION_REVIEWER', 'C Iyer'),
      ],
    });
    expect(checkPublishable(notice)).toEqual([]);
  });

  it('does not wave through a content kind it has no rule for', () => {
    const unknown = candidate({ contentKind: 'SOMETHING_NEW', approvals: [] });
    expect(checkPublishable(unknown).join()).toMatch(/at least one named approval/);
  });
});
