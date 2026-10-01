import { Logger } from '@nestjs/common';
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { ComposeInput } from './deterministic-composer';
import {
  clinicalDraftSchema,
  type ClinicalDraft,
  type DraftSection,
  type DraftStatement,
} from './draft.contract';
import type { DraftGenerator } from './generator.adapter';

/**
 * Model-backed pre-consultation draft generator.
 *
 * Calls `services/ai_worker` when one is configured, and composes the draft in-process
 * when it is not — or when what came back cannot be trusted. Either path produces output
 * that holds the clinical draft properties:
 *  - Schema compliance
 *  - Grounded vocabulary
 *  - Provenance on every statement
 *  - Mandatory NO_DIAGNOSIS_STATEMENT
 *
 * The worker is a separate process on the hospital network, so its response is treated as
 * untrusted input rather than as a return value: it is parsed against the draft contract
 * before it is handed on, and a response that does not parse is dropped in favour of the
 * local composition. The safety validator downstream is the actual authority and runs over
 * either path regardless — this check exists so that a worker whose output has drifted
 * shows up as one warning naming the field, instead of as a rejected draft per patient.
 */
export class ModelDraftGenerator implements DraftGenerator {
  readonly name = 'model';
  readonly version = 'model-v1.0';
  private readonly logger = new Logger(ModelDraftGenerator.name);

  constructor(
    private readonly aiWorkerUrl?: string,
    private readonly timeoutMs: number = 5_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(input: ComposeInput): Promise<ClinicalDraft> {
    const fromWorker = this.aiWorkerUrl ? await this.askWorker(input) : null;
    return fromWorker ?? this.synthesizeDraft(input);
  }

  /** Returns null for every failure, because the caller's answer is the same for all of them. */
  private async askWorker(input: ComposeInput): Promise<ClinicalDraft | null> {
    // A worker that never answers must not hold up a patient's token. `fetch` has no
    // timeout of its own, so without this the request is bounded only by the TCP stack.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.aiWorkerUrl}/v1/summary/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`AI worker returned HTTP ${res.status}; composing locally`);
        return null;
      }

      const parsed = clinicalDraftSchema.safeParse(await res.json());
      if (!parsed.success) {
        // The failing paths, not the draft: a malformed response still describes one
        // patient's symptoms, and what a maintainer needs is which field is wrong.
        const where = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
        this.logger.warn(`AI worker response did not match the draft contract (${where})`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      const why = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`AI worker unreachable (${why}); composing locally`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private synthesizeDraft(input: ComposeInput): ClinicalDraft {
    const sections: DraftSection[] = [];

    const sectionHeadings: Record<string, string> = {
      REASON_FOR_VISIT: 'Reason for visit',
      DURATION_ONSET: 'Duration and onset',
      SEVERITY_IMPACT: 'Severity and impact',
      CURRENT_MEDICINES: 'Current medicines',
      ALLERGIES: 'Allergies',
      PAST_HISTORY: 'Past history',
      OTHER: 'Other information',
      DOCUMENTS: 'Documents',
    };

    let reasonForVisit = 'intake';

    for (const [key, heading] of Object.entries(sectionHeadings)) {
      if (key === 'DOCUMENTS') continue;

      const statements: DraftStatement[] = [];
      for (const a of input.answers) {
        if (!a.answered || a.sectionKey !== key) continue;
        const chosen = a.optionLabels.length > 0 ? a.optionLabels.join(', ') : null;
        const spoken = a.value?.trim() ?? '';
        const body = spoken.length > 0 ? spoken : chosen;
        if (!body) continue;

        if (key === 'REASON_FOR_VISIT') {
          reasonForVisit = body;
        }

        statements.push({
          text: `Patient reported: "${body}"`,
          provenance:
            a.source === 'PATIENT_SELECTED'
              ? PROVENANCE_LABELS.PATIENT_SELECTED
              : a.source === 'SYSTEM_DETECTED'
                ? PROVENANCE_LABELS.SYSTEM_DETECTED
                : PROVENANCE_LABELS.PATIENT_REPORTED,
          sourceRef: a.questionId,
        });
      }

      if (statements.length > 0) {
        sections.push({ key, heading, statements });
      }
    }

    if (input.documents.length > 0) {
      sections.push({
        key: 'DOCUMENTS',
        heading: 'Documents',
        statements: input.documents.map((d) => ({
          text: `"${d.label}" uploaded`,
          provenance:
            d.extractionState === 'AWAITING_CLINICIAN_REVIEW'
              ? PROVENANCE_LABELS.OCR_EXTRACTED
              : PROVENANCE_LABELS.SOURCE_DOCUMENT,
          sourceRef: d.documentId,
        })),
      });
    }

    const narrative = `Patient reported: "${reasonForVisit}". ${NO_DIAGNOSIS_STATEMENT}`;

    return { narrative, sections };
  }
}
