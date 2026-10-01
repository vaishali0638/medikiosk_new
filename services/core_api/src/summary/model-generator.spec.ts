import { NO_DIAGNOSIS_STATEMENT } from '@medikiosk/terminology';
import { ModelDraftGenerator } from './model-generator.adapter';
import { validateDraft, type GroundingMaterial } from './safety-validator';
import type { ComposeInput } from './deterministic-composer';

describe('ModelDraftGenerator', () => {
  const generator = new ModelDraftGenerator();

  const input: ComposeInput = {
    answers: [
      {
        questionId: 'q.reason',
        prompt: 'What brings you today?',
        optionLabels: [],
        value: 'knee pain for two months',
        source: 'PATIENT_REPORTED',
        sectionKey: 'REASON_FOR_VISIT',
        answered: true,
      },
      {
        questionId: 'q.duration',
        prompt: 'How long has this problem been present?',
        optionLabels: ['1–6 months'],
        value: null,
        source: 'PATIENT_SELECTED',
        sectionKey: 'DURATION_ONSET',
        answered: true,
      },
      {
        questionId: 'q.medicines',
        prompt: 'Are you taking any medicine for this problem?',
        optionLabels: [],
        value: 'Metformin 500 mg twice a day',
        source: 'PATIENT_REPORTED',
        sectionKey: 'CURRENT_MEDICINES',
        answered: true,
      },
    ],
    documents: [
      {
        documentId: 'doc-1',
        label: 'Lab report',
        extractionState: 'AWAITING_CLINICIAN_REVIEW',
      },
    ],
  };

  const material: GroundingMaterial = {
    answerTexts: [
      ...input.answers.map((a) => a.prompt),
      ...input.answers.flatMap((a) => a.optionLabels),
      ...input.answers.map((a) => a.value ?? ''),
    ],
    documentLabels: input.documents.map((d) => d.label),
  };

  it('generates a draft candidate that passes safety validation', async () => {
    const candidate = await generator.generate(input);
    const verdict = validateDraft(candidate, material);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.draft.narrative).toContain(NO_DIAGNOSIS_STATEMENT);
      expect(verdict.draft.sections.length).toBeGreaterThan(0);
      const reasonSection = verdict.draft.sections.find((s) => s.key === 'REASON_FOR_VISIT');
      expect(reasonSection).toBeDefined();
      expect(reasonSection?.statements[0]?.text).toContain('knee pain for two months');
    }
  });
});
