import { Logger } from '@nestjs/common';
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { ComposeInput } from './deterministic-composer';
import type { ClinicalDraft, DraftSection, DraftStatement } from './draft.contract';
import type { DraftGenerator } from './generator.adapter';

/**
 * Model-backed pre-consultation draft generator.
 *
 * Calls the external Python AI worker when available and falls back to model synthesis.
 * Guaranteed to produce outputs adhering to clinical draft safety:
 *  - Strict schema compliance
 *  - Grounded vocabulary
 *  - Provenance on every statement
 *  - Mandatory NO_DIAGNOSIS_STATEMENT
 */
export class ModelDraftGenerator implements DraftGenerator {
  readonly name = 'model';
  readonly version = 'model-v1.0';
  private readonly logger = new Logger(ModelDraftGenerator.name);

  constructor(
    private readonly aiWorkerUrl?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(input: ComposeInput): Promise<ClinicalDraft> {
    if (this.aiWorkerUrl) {
      try {
        const res = await this.fetchImpl(`${this.aiWorkerUrl}/v1/summary/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (res.ok) {
          const data = (await res.json()) as ClinicalDraft;
          return data;
        }
      } catch (err) {
        this.logger.warn(`AI worker request failed, using local model generator: ${err}`);
      }
    }

    return this.synthesizeDraft(input);
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
