import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import { compose, type ComposableAnswer, type ComposeInput } from './deterministic-composer';
import { validateDraft, type GroundingMaterial } from './safety-validator';
import type { ClinicalDraft } from './draft.contract';

const answer = (over: Partial<ComposableAnswer> = {}): ComposableAnswer => ({
  questionId: 'q.reason',
  prompt: 'What brings you today?',
  optionLabels: [],
  value: 'knee pain for two months',
  source: 'PATIENT_REPORTED',
  sectionKey: 'REASON_FOR_VISIT',
  answered: true,
  ...over,
});

const materialFor = (input: ComposeInput): GroundingMaterial => ({
  answerTexts: [
    ...input.answers.map((a) => a.prompt),
    ...input.answers.flatMap((a) => a.optionLabels),
    ...input.answers.map((a) => a.value ?? ''),
  ],
  documentLabels: input.documents.map((d) => d.label),
});

/** A draft built on top of a valid one, so a test changes exactly one thing. */
const withNarrative = (draft: ClinicalDraft, narrative: string): ClinicalDraft => ({
  ...draft,
  narrative,
});

describe('the validator judges the composer', () => {
  const input: ComposeInput = {
    answers: [
      answer(),
      answer({
        questionId: 'q.duration',
        prompt: 'How long has this problem been present?',
        optionLabels: ['1–6 months'],
        value: null,
        source: 'PATIENT_SELECTED',
        sectionKey: 'DURATION_ONSET',
      }),
      answer({
        questionId: 'q.medicines',
        prompt: 'Are you taking any medicine for this problem?',
        value: 'Metformin 500 mg twice a day',
        sectionKey: 'CURRENT_MEDICINES',
      }),
      answer({
        questionId: 'q.allergy',
        prompt: 'Do you have any allergy?',
        value: null,
        answered: false,
        sectionKey: 'ALLERGIES',
      }),
    ],
    documents: [
      { documentId: 'doc-1', label: 'Lab report', extractionState: 'AWAITING_CLINICIAN_REVIEW' },
    ],
  };

  // The point of this test: a validator its own author's output cannot pass is one nobody
  // will trust, and one only ever run against a model has never seen a known-good input.
  it('accepts the deterministic draft it will judge every model against', () => {
    const result = validateDraft(compose(input), materialFor(input));

    if (!result.ok) {
      throw new Error(`composer failed its own gate: ${JSON.stringify(result.problems, null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  it('keeps a patient-reported dose, which is clinically useful and not advice', () => {
    const draft = compose(input);
    const medicines = draft.sections.find((s) => s.key === 'CURRENT_MEDICINES');

    expect(medicines?.statements[0]?.text).toContain('Metformin 500 mg twice a day');
    expect(validateDraft(draft, materialFor(input)).ok).toBe(true);
  });

  it('reports an unanswered question rather than omitting it', () => {
    const draft = compose(input);
    const skipped = draft.sections.find((s) => s.key === 'NOT_ANSWERED');

    // A doctor who cannot see that the allergy question was skipped will read it as "no".
    expect(skipped?.statements[0]?.text).toContain('Do you have any allergy?');
    expect(skipped?.statements[0]?.provenance).toBe(PROVENANCE_LABELS.SYSTEM_DETECTED);
  });

  it('labels an OCR-read document for verification and a plain one as a source', () => {
    const draft = compose({
      ...input,
      documents: [
        { documentId: 'a', label: 'Lab report', extractionState: 'AWAITING_CLINICIAN_REVIEW' },
        { documentId: 'b', label: 'Prescription', extractionState: null },
      ],
    });
    const documents = draft.sections.find((s) => s.key === 'DOCUMENTS');

    expect(documents?.statements[0]?.provenance).toBe(PROVENANCE_LABELS.OCR_EXTRACTED);
    expect(documents?.statements[1]?.provenance).toBe(PROVENANCE_LABELS.SOURCE_DOCUMENT);
  });

  it('opens with the patient’s own words, not the option they picked first', () => {
    const described: ComposeInput = {
      answers: [
        answer({
          questionId: 'q.complaint',
          optionLabels: ['Something else'],
          value: null,
          source: 'PATIENT_SELECTED',
        }),
        answer({ questionId: 'q.detail', value: 'knee pain for two months' }),
      ],
      documents: [],
    };

    // "Patient reports 'Something else'" is worse than no opening line at all.
    const narrative = compose(described).narrative;
    expect(narrative).toContain('knee pain for two months');
    expect(narrative).not.toContain('Something else');
    expect(validateDraft(compose(described), materialFor(described)).ok).toBe(true);
  });

  it('falls back to the selected option when nothing was described', () => {
    const selected: ComposeInput = {
      answers: [answer({ optionLabels: ['Pain'], value: null, source: 'PATIENT_SELECTED' })],
      documents: [],
    };

    expect(compose(selected).narrative).toContain('Pain');
  });

  it('states the absence of a diagnosis instead of leaving it silent', () => {
    expect(compose(input).narrative).toContain(NO_DIAGNOSIS_STATEMENT);
  });

  it('emits no number the patient did not say', () => {
    const draft = compose(input);
    // "Answered 3 of 21 questions" would be a fabricated number in a clinical draft, which
    // is a dose or a duration waiting to happen. Counts belong in the structured sections.
    expect(draft.narrative).not.toMatch(/\b\d+\b/);
  });
});

describe('what the gate refuses', () => {
  const input: ComposeInput = { answers: [answer()], documents: [] };
  const material = materialFor(input);
  const good = compose(input);

  const refuse = (narrative: string): readonly string[] => {
    const result = validateDraft(withNarrative(good, narrative), material);
    if (result.ok) throw new Error(`expected refusal for: ${narrative}`);
    return result.problems.map((p) => p.code);
  };

  it('refuses a diagnosis heading', () => {
    // The specification's own example.
    expect(refuse(`Diagnosis: Arthritis. ${NO_DIAGNOSIS_STATEMENT}`)).toContain(
      'DIAGNOSIS_HEADING',
    );
  });

  it('refuses hedged inference, which is a diagnosis with a hedge', () => {
    expect(refuse(`Findings are suggestive of arthritis. ${NO_DIAGNOSIS_STATEMENT}`)).toContain(
      'INFERENTIAL_PHRASE',
    );
    expect(refuse(`This is most likely degenerative. ${NO_DIAGNOSIS_STATEMENT}`)).toContain(
      'PROBABILITY_CLAIM',
    );
    expect(refuse(`Cannot rule out infection. ${NO_DIAGNOSIS_STATEMENT}`)).toContain('RULE_OUT');
  });

  it('refuses treatment advice', () => {
    expect(refuse(`Recommend an X-ray. ${NO_DIAGNOSIS_STATEMENT}`)).toContain('RECOMMENDATION');
    expect(refuse(`Patient should stop the medicine. ${NO_DIAGNOSIS_STATEMENT}`)).toContain(
      'INSTRUCTION',
    );
  });

  it('refuses an urgency claim, because red flags are internal', () => {
    expect(refuse(`Patient needs urgent review. ${NO_DIAGNOSIS_STATEMENT}`)).toContain(
      'URGENCY_CLAIM',
    );
  });

  it('refuses a condition the patient never mentioned, whatever it is called', () => {
    // The reason grounding is an allowlist and not a blocklist of disease names: this
    // fails without anyone having heard of the condition.
    const codes = refuse(`Patient reports gonarthrosis. ${NO_DIAGNOSIS_STATEMENT}`);
    expect(codes).toContain('UNGROUNDED_TERM');
  });

  it('refuses a number the patient did not say', () => {
    const codes = refuse(`Patient reports pain for 14 days. ${NO_DIAGNOSIS_STATEMENT}`);
    expect(codes).toContain('UNGROUNDED_TERM');
  });

  it('refuses a draft that omits the no-diagnosis statement', () => {
    expect(refuse('Patient reports knee pain for two months.')).toContain(
      'MISSING_NO_DIAGNOSIS_STATEMENT',
    );
  });

  it('refuses a statement with no provenance rather than assigning one', () => {
    const result = validateDraft(
      {
        narrative: good.narrative,
        sections: [
          {
            key: 'REASON_FOR_VISIT',
            heading: 'Reason for visit',
            statements: [{ text: 'Patient reports knee pain', sourceRef: 'q.reason' }],
          },
        ],
      },
      material,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain('SCHEMA_INVALID');
  });

  it('refuses a statement claiming to be clinician-verified', () => {
    const result = validateDraft(
      {
        narrative: good.narrative,
        sections: [
          {
            key: 'REASON_FOR_VISIT',
            heading: 'Reason for visit',
            statements: [
              {
                text: 'Patient reports knee pain',
                provenance: PROVENANCE_LABELS.CLINICIAN_VERIFIED,
                sourceRef: 'q.reason',
              },
            ],
          },
        ],
      },
      material,
    );

    // Nothing a generator produces is verified. The label is not in the statement enum at
    // all, so this fails as a schema error rather than as a judgement call.
    expect(result.ok).toBe(false);
  });

  it('reports every problem at once, not the first', () => {
    const codes = refuse('Diagnosis: gonarthrosis. Recommend urgent review.');

    expect(codes).toEqual(
      expect.arrayContaining([
        'DIAGNOSIS_HEADING',
        'RECOMMENDATION',
        'URGENCY_CLAIM',
        'UNGROUNDED_TERM',
        'MISSING_NO_DIAGNOSIS_STATEMENT',
      ]),
    );
  });
});

describe('the patient’s own words', () => {
  it('are not censored by the rules meant for the system’s voice', () => {
    const input: ComposeInput = {
      answers: [answer({ value: 'it is probably from lifting a heavy sack' })],
      documents: [],
    };

    // "probably" would trip PROBABILITY_CLAIM in the kiosk's voice. In a quoted patient
    // description it is a detail the doctor should read, and paraphrasing a symptom
    // description to avoid the word would be worse than the word.
    const result = validateDraft(compose(input), materialFor(input));
    expect(result.ok).toBe(true);
  });

  it('cannot be used to smuggle in a diagnosis by quoting it', () => {
    const input: ComposeInput = { answers: [answer()], documents: [] };
    const draft: ClinicalDraft = {
      ...compose(input),
      sections: [
        {
          key: 'REASON_FOR_VISIT',
          heading: 'Reason for visit',
          statements: [
            {
              text: 'Patient reported: "likely rheumatoid arthritis"',
              provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
              sourceRef: 'q.reason',
            },
          ],
        },
      ],
    };

    // The quote exempts it from the banned scan, but a quote can only contain words the
    // patient used — so grounding catches it instead.
    const result = validateDraft(draft, materialFor(input));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain('UNGROUNDED_TERM');
  });
});
