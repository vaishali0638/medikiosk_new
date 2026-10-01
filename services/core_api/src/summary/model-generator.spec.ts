import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import { ModelDraftGenerator } from './model-generator.adapter';
import { STATEMENT_PROVENANCE } from './draft.contract';
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

  /**
   * The worker is a separate process, so these cover what it can do wrong rather than what
   * it does right: the useful property is that none of it reaches a clinician.
   */
  describe('with an AI worker configured', () => {
    const okResponse = (body: unknown): Response =>
      ({ ok: true, status: 200, json: async () => body }) as Response;

    it('uses a worker response that matches the draft contract', async () => {
      const worker = jest.fn(async () =>
        okResponse({
          narrative: `Patient reported: "knee pain for two months". ${NO_DIAGNOSIS_STATEMENT}`,
          sections: [
            {
              key: 'REASON_FOR_VISIT',
              heading: 'Reason for visit',
              statements: [
                {
                  text: 'Patient reported: "knee pain for two months"',
                  provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
                  sourceRef: 'q.reason',
                },
              ],
            },
          ],
        }),
      );

      const candidate = await new ModelDraftGenerator(
        'http://ai-worker.invalid',
        5_000,
        worker as unknown as typeof fetch,
      ).generate(input);

      expect(worker).toHaveBeenCalledTimes(1);
      const verdict = validateDraft(candidate, material);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) {
        // The worker's draft, not the local one: local text has no section for q.reason
        // alone, so this is the response having actually been used.
        expect(verdict.draft.sections).toHaveLength(1);
      }
    });

    /**
     * The shape the worker emitted before it was aligned with the contract: `label` and
     * `source` instead of `provenance` and `sourceRef`. Every response failed the safety
     * gate, once per patient, and the draft a clinician read was the local one anyway.
     */
    it('falls back to local composition when the response does not match the contract', async () => {
      const worker = jest.fn(async () =>
        okResponse({
          narrative: 'Patient reports knee pain for two months.',
          sections: [
            {
              key: 'REASON_FOR_VISIT',
              heading: 'Reason for visit',
              statements: [
                {
                  text: 'knee pain for two months',
                  label: 'Patient-reported',
                  source: 'PATIENT_REPORTED',
                },
              ],
            },
          ],
        }),
      );

      const candidate = await new ModelDraftGenerator(
        'http://ai-worker.invalid',
        5_000,
        worker as unknown as typeof fetch,
      ).generate(input);

      const verdict = validateDraft(candidate, material);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) {
        expect(verdict.draft.narrative).toContain(NO_DIAGNOSIS_STATEMENT);
        for (const section of verdict.draft.sections) {
          for (const statement of section.statements) {
            expect(STATEMENT_PROVENANCE).toContain(statement.provenance);
            expect(statement.sourceRef.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('falls back when the worker refuses', async () => {
      const worker = jest.fn(async () => ({ ok: false, status: 503 }) as Response);

      const candidate = await new ModelDraftGenerator(
        'http://ai-worker.invalid',
        5_000,
        worker as unknown as typeof fetch,
      ).generate(input);

      expect(validateDraft(candidate, material).ok).toBe(true);
    });

    it('falls back when the worker is unreachable', async () => {
      const worker = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      const candidate = await new ModelDraftGenerator(
        'http://ai-worker.invalid',
        5_000,
        worker as unknown as typeof fetch,
      ).generate(input);

      expect(validateDraft(candidate, material).ok).toBe(true);
    });

    /**
     * A patient is standing at the kiosk. The request is aborted and the draft composed
     * locally; before the timeout existed, `fetch` was bounded only by the TCP stack.
     */
    it('abandons a worker that never answers and composes locally', async () => {
      const worker = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

      const candidate = await new ModelDraftGenerator(
        'http://ai-worker.invalid',
        20,
        worker as unknown as typeof fetch,
      ).generate(input);

      expect(validateDraft(candidate, material).ok).toBe(true);
    });
  });
});
