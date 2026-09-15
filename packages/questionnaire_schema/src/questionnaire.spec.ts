import {
  applicableQuestions,
  compose,
  evaluate,
  nextQuestion,
  validateQuestionnaire,
  type AnswerLookup,
  type Questionnaire,
} from './index';

const q = (
  id: string,
  extra: Partial<Questionnaire['nodes'][number]['question']> = {},
): Questionnaire['nodes'][number]['question'] => ({
  id,
  type: 'SINGLE_SELECT',
  section: 'OTHER',
  prompt: `Prompt for ${id}`,
  options: [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ],
  sensitive: false,
  nonCommittal: ['NOT_SURE', 'PREFER_TO_DISCUSS_WITH_DOCTOR', 'NOT_APPLICABLE'],
  ...extra,
});

const questionnaire = (nodes: Questionnaire['nodes']): Questionnaire => ({
  key: 'common-core',
  version: '1.0.0',
  language: 'en',
  title: 'Test questionnaire',
  nodes,
  approvedBy: ['Dr Test'],
});

describe('branching conditions', () => {
  const answers: AnswerLookup = { pain: ['yes'], site: ['knee', 'back'] };

  it('ALWAYS is always true', () => {
    expect(evaluate({ kind: 'ALWAYS' }, {})).toBe(true);
  });

  it('ANSWERED distinguishes answered from absent', () => {
    expect(evaluate({ kind: 'ANSWERED', questionId: 'pain' }, answers)).toBe(true);
    expect(evaluate({ kind: 'ANSWERED', questionId: 'fever' }, answers)).toBe(false);
  });

  it('EQUALS matches a selected option', () => {
    expect(evaluate({ kind: 'EQUALS', questionId: 'pain', value: 'yes' }, answers)).toBe(true);
    expect(evaluate({ kind: 'EQUALS', questionId: 'pain', value: 'no' }, answers)).toBe(false);
  });

  it('IN matches any of several, including multi-select answers', () => {
    expect(evaluate({ kind: 'IN', questionId: 'site', values: ['neck', 'back'] }, answers)).toBe(
      true,
    );
    expect(evaluate({ kind: 'IN', questionId: 'site', values: ['neck'] }, answers)).toBe(false);
  });

  it('combines with ALL, ANY and NOT', () => {
    const all = {
      kind: 'ALL' as const,
      of: [
        { kind: 'EQUALS' as const, questionId: 'pain', value: 'yes' },
        { kind: 'IN' as const, questionId: 'site', values: ['knee'] },
      ],
    };
    expect(evaluate(all, answers)).toBe(true);
    expect(evaluate({ kind: 'NOT', of: all }, answers)).toBe(false);
    expect(
      evaluate(
        { kind: 'ANY', of: [{ kind: 'EQUALS', questionId: 'pain', value: 'no' }, all] },
        answers,
      ),
    ).toBe(true);
  });

  it('treats an unknown question as unanswered rather than throwing', () => {
    // A questionnaire that references a question it never asks must not strand a patient.
    expect(evaluate({ kind: 'EQUALS', questionId: 'nope', value: 'x' }, answers)).toBe(false);
    expect(evaluate({ kind: 'ANSWERED', questionId: 'nope' }, answers)).toBe(false);
  });
});

describe('walking the questionnaire', () => {
  const withBranch = questionnaire([
    { question: q('pain') },
    {
      question: q('painSite', { type: 'MULTI_SELECT' }),
      askWhen: { kind: 'EQUALS', questionId: 'pain', value: 'yes' },
    },
    { question: q('medicines') },
  ]);

  it('starts at the first question', () => {
    expect(nextQuestion(withBranch, {})?.question.id).toBe('pain');
  });

  it('follows a branch when its condition holds', () => {
    expect(nextQuestion(withBranch, { pain: ['yes'] })?.question.id).toBe('painSite');
  });

  it('skips a branch when its condition does not hold', () => {
    expect(nextQuestion(withBranch, { pain: ['no'] })?.question.id).toBe('medicines');
  });

  it('returns null when everything applicable is answered', () => {
    expect(nextQuestion(withBranch, { pain: ['no'], medicines: ['no'] })).toBeNull();
  });

  it('is deterministic — the same answers always give the same question', () => {
    const a = nextQuestion(withBranch, { pain: ['yes'] });
    const b = nextQuestion(withBranch, { pain: ['yes'] });
    expect(a?.question.id).toBe(b?.question.id);
  });

  it('counts progress against questions that will actually be asked', () => {
    // Skipped branches must not make the bar look stuck.
    const skipped = nextQuestion(withBranch, { pain: ['no'] });
    expect(skipped?.totalApplicable).toBe(2);
    expect(skipped?.answeredCount).toBe(1);

    const taken = nextQuestion(withBranch, { pain: ['yes'] });
    expect(taken?.totalApplicable).toBe(3);
  });

  it('treats a non-committal answer as answered, so the interview moves on', () => {
    // "Prefer to discuss with doctor" is a complete answer, not a failure to answer.
    expect(nextQuestion(withBranch, { pain: ['PREFER_TO_DISCUSS_WITH_DOCTOR'] })?.question.id).toBe(
      'medicines',
    );
  });

  it('lists the applicable questions for the review screen', () => {
    expect(applicableQuestions(withBranch, { pain: ['no'] }).map((x) => x.id)).toEqual([
      'pain',
      'medicines',
    ]);
  });
});

describe('publish-time validation', () => {
  it('accepts a well-formed questionnaire', () => {
    expect(validateQuestionnaire(questionnaire([{ question: q('pain') }]))).toEqual([]);
  });

  it('rejects duplicate question ids', () => {
    const problems = validateQuestionnaire(
      questionnaire([{ question: q('pain') }, { question: q('pain') }]),
    );
    expect(problems.join()).toMatch(/duplicate question id/);
  });

  it('rejects a select question with no options', () => {
    const problems = validateQuestionnaire(
      questionnaire([{ question: q('pain', { options: [] }) }]),
    );
    expect(problems.join()).toMatch(/offers no options/);
  });

  it('rejects a sensitive question with no explanation', () => {
    // The "why are we asking?" rule is meaningless without the text it shows.
    const problems = validateQuestionnaire(
      questionnaire([{ question: q('smoking', { sensitive: true }) }]),
    );
    expect(problems.join()).toMatch(/gives no explanation/);
  });

  it('rejects a question that offers no way to decline', () => {
    const problems = validateQuestionnaire(
      questionnaire([{ question: q('pain', { nonCommittal: [] }) }]),
    );
    expect(problems.join()).toMatch(/no way to decline/);
  });

  it('rejects a branch on a question asked later', () => {
    // Otherwise the patient reaches a branch whose condition was never decided.
    const problems = validateQuestionnaire(
      questionnaire([
        { question: q('a'), askWhen: { kind: 'EQUALS', questionId: 'b', value: 'yes' } },
        { question: q('b') },
      ]),
    );
    expect(problems.join()).toMatch(/is not asked before it/);
  });

  it('accepts a branch on a question asked earlier', () => {
    expect(
      validateQuestionnaire(
        questionnaire([
          { question: q('a') },
          { question: q('b'), askWhen: { kind: 'EQUALS', questionId: 'a', value: 'yes' } },
        ]),
      ),
    ).toEqual([]);
  });

  it('rejects a release version with no named approver', () => {
    // A plain semver version is a claim that a practitioner signed this off.
    const unapproved = { ...questionnaire([{ question: q('pain') }]), approvedBy: [] };
    expect(validateQuestionnaire(unapproved).join()).toMatch(/names no approver/);
  });

  it('accepts a pre-release version with no approver', () => {
    // Unreviewed content is allowed to exist — it just has to say so in its version.
    const draft = {
      ...questionnaire([{ question: q('pain') }]),
      version: '0.1.0-placeholder',
      approvedBy: [],
    };
    expect(validateQuestionnaire(draft)).toEqual([]);
  });

  it('rejects a numeric scale with no scale defined', () => {
    const problems = validateQuestionnaire(
      questionnaire([{ question: q('severity', { type: 'NUMERIC_SCALE', options: undefined }) }]),
    );
    expect(problems.join()).toMatch(/defines no scale/);
  });
});

describe('composing a module onto the core', () => {
  const core = questionnaire([{ question: q('chiefComplaint') }, { question: q('duration') }]);
  const module: Questionnaire = {
    key: 'ayurveda',
    version: '1.0.0',
    language: 'en',
    title: 'Ayurveda',
    nodes: [{ question: q('prakriti') }, { question: q('agni') }],
    approvedBy: ['Dr A Sharma'],
  };

  it('returns the core unchanged when no module is selected', () => {
    const { questionnaire: composed, problems } = compose(core, null);
    expect(problems).toEqual([]);
    expect(composed.nodes.map((n: Questionnaire['nodes'][number]) => n.question.id)).toEqual([
      'chiefComplaint',
      'duration',
    ]);
  });

  it('puts the core first, then the module', () => {
    // An intake abandoned halfway still carries the universally useful part.
    const { questionnaire: composed } = compose(core, module);
    expect(composed.nodes.map((n: Questionnaire['nodes'][number]) => n.question.id)).toEqual([
      'chiefComplaint',
      'duration',
      'prakriti',
      'agni',
    ]);
  });

  it('records both versions, because that is what the patient was shown', () => {
    const { questionnaire: composed } = compose(core, module);
    expect(composed.version).toBe('1.0.0+ayurveda.1.0.0');
  });

  it('refuses a module that reuses a core question id', () => {
    // Two meanings for one stored answer is not something to resolve silently.
    const clashing: Questionnaire = { ...module, nodes: [{ question: q('duration') }] };
    expect(compose(core, clashing).problems.join()).toMatch(/reuses question id "duration"/);
  });

  it('refuses a module published in another language', () => {
    const mismatched: Questionnaire = { ...module, language: 'hi' };
    expect(compose(core, mismatched).problems.join()).toMatch(/published in hi/);
  });

  it('walks straight from the core into the module', () => {
    const { questionnaire: composed } = compose(core, module);
    expect(
      nextQuestion(composed, { chiefComplaint: ['yes'], duration: ['yes'] })?.question.id,
    ).toBe('prakriti');
  });
});

/**
 * An answer that selects no option still counts as answered.
 *
 * The bug this guards against made the interview impossible to finish. A NUMERIC_SCALE
 * answer carries its content in `value` and selects nothing, so it contributed an empty
 * array to the lookup — and an empty array read as "not answered yet". A patient who
 * answered "how severe is it?" with a 7 was asked again, and again, for as long as they
 * kept answering. It survived 418 integration tests because every one of them answered
 * with options.
 */
describe('answers that carry a value rather than a selection', () => {
  const valueOnly = questionnaire([
    { question: q('severity', { type: 'NUMERIC_SCALE' }) },
    { question: q('anythingElse', { type: 'TEXT' }) },
  ]);

  it('re-asks the question when told only about selected options', () => {
    // The old behaviour, kept as the default and asserted so the difference is visible.
    expect(nextQuestion(valueOnly, { severity: [] })?.question.id).toBe('severity');
  });

  it('moves on once told which questions were answered', () => {
    const next = nextQuestion(valueOnly, { severity: [] }, new Set(['severity']));
    expect(next?.question.id).toBe('anythingElse');
    expect(next?.answeredCount).toBe(1);
  });

  it('terminates an interview made entirely of value answers', () => {
    expect(
      nextQuestion(
        valueOnly,
        { severity: [], anythingElse: [] },
        new Set(['severity', 'anythingElse']),
      ),
    ).toBeNull();
  });

  it('lets an ANSWERED branch fire for a value answer', () => {
    // Same root cause in a second place: ANSWERED also read the selected options, so a
    // branch conditioned on "they answered the severity question" could never be taken by
    // a patient who answered it with a number.
    const gated = questionnaire([
      { question: q('severity', { type: 'NUMERIC_SCALE' }) },
      {
        question: q('anythingElse', { type: 'TEXT' }),
        askWhen: { kind: 'ANSWERED', questionId: 'severity' },
      },
    ]);

    expect(nextQuestion(gated, { severity: [] }, new Set(['severity']))?.question.id).toBe(
      'anythingElse',
    );
  });

  it('still branches on selections, not on answeredness', () => {
    // Answering a branch question with a value must not fire a branch that depends on a
    // particular option having been chosen. That is why the two are separate arguments.
    const branched = questionnaire([
      { question: q('severity', { type: 'NUMERIC_SCALE' }) },
      {
        question: q('anythingElse', { type: 'TEXT' }),
        askWhen: { kind: 'IN', questionId: 'severity', values: ['high'] },
      },
    ]);

    expect(nextQuestion(branched, { severity: [] }, new Set(['severity']))).toBeNull();
    expect(nextQuestion(branched, { severity: ['high'] }, new Set(['severity']))?.question.id).toBe(
      'anythingElse',
    );
  });
});
