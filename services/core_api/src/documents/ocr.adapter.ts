import { Injectable } from '@nestjs/common';

/**
 * One extracted field, with its own confidence.
 *
 * Confidence is per FIELD, not per document. A prescription can be crisp in the patient
 * name and illegible in the dose, and a single document-level score would hide exactly
 * the difference that matters.
 */
export interface ExtractedField {
  readonly name: string;
  readonly value: string;
  readonly confidence: number;
  /** Where on the page it was read from, so the doctor can look at that part of the scan. */
  readonly boundingBox?: { x: number; y: number; width: number; height: number } | undefined;
}

export type OcrResult =
  | {
      readonly outcome: 'EXTRACTED';
      readonly fields: readonly ExtractedField[];
      readonly rawText: string;
      readonly overallConfidence: number;
      readonly extractorVersion: string;
    }
  | { readonly outcome: 'FAILED'; readonly errorCode: string }
  | { readonly outcome: 'UNAVAILABLE'; readonly detail: string };

/**
 * Optical character recognition and field extraction.
 *
 * Production is the Python AI worker: OpenCV for deskew and quality, an OCR engine, then
 * field extraction against a governed medicine and terminology dictionary.
 */
export abstract class OcrAdapter {
  abstract readonly kind: string;
  abstract extract(bytes: Buffer, contentType: string, documentType: string): Promise<OcrResult>;
}

/**
 * The adapter used when no AI worker is running.
 *
 * It returns UNAVAILABLE and never invents fields. That is not laziness — a stub that
 * produced plausible medicine names and doses would put fabricated clinical text in front
 * of a doctor wearing an `OCR-EXTRACTED` label, which is precisely the provenance the
 * label is supposed to guarantee. Better that the doctor sees the original scan and no
 * extraction at all.
 */
@Injectable()
export class UnavailableOcrAdapter extends OcrAdapter {
  readonly kind = 'unavailable';

  async extract(): Promise<OcrResult> {
    return {
      outcome: 'UNAVAILABLE',
      detail: 'no OCR worker is configured; the original is stored and awaits the doctor',
    };
  }
}
