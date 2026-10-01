/**
 * Verifies that `services/ai_worker` still answers in the shape a draft must have.
 *
 * The worker is Python and the draft contract is TypeScript, so nothing but this check
 * connects them: `tsc` cannot see across the boundary and the unit tests exercise the
 * adapter against a stubbed `fetch`, which proves the adapter's handling and not the
 * worker's output. The one failure this exists to catch is the worker drifting back to a
 * shape core_api rejects — a draft missing `provenance` or `sourceRef` fails the safety
 * gate, so the symptom is not an error but a silent fall back to local composition, on
 * every single patient, with the AI worker apparently healthy the whole time.
 *
 * Checks the same response twice over: once against the schema, which is what the adapter
 * requires before it will hand the draft on, and once against the full safety validator,
 * which is what decides whether a clinician ever sees it.
 *
 *   npm run aiworker:check -w @medikiosk/core-api
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clinicalDraftSchema } from '../src/summary/draft.contract';
import { validateDraft, type GroundingMaterial } from '../src/summary/safety-validator';
import type { ComposeInput } from '../src/summary/deterministic-composer';

const PORT = Number(process.env['AI_WORKER_CHECK_PORT'] ?? 8099);
const SERVER = resolve(__dirname, '../../ai_worker/server.py');

const line = (ok: boolean, what: string, detail = ''): void => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}\n`);
};

/**
 * Deliberately includes the awkward cases: an unanswered question, an answer with no text
 * at all, and a document awaiting review. Each one is a chance for the worker to emit a
 * statement it cannot ground or label.
 */
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
      questionId: 'q.allergies',
      prompt: 'Any allergies?',
      optionLabels: [],
      value: null,
      source: 'PATIENT_REPORTED',
      sectionKey: 'ALLERGIES',
      answered: false,
    },
  ],
  documents: [
    { documentId: 'doc-1', label: 'Lab report', extractionState: 'AWAITING_CLINICIAN_REVIEW' },
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

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  process.stdout.write(`\nai_worker draft contract (port ${PORT})\n`);

  const worker = spawn('python3', [SERVER, String(PORT)], { stdio: 'ignore' });
  const stop = (): void => {
    worker.kill();
  };
  process.on('exit', stop);

  let up = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await reachable(`http://127.0.0.1:${PORT}/health`)) {
      up = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) {
    line(false, 'worker started', `python3 ${SERVER} did not answer on :${PORT}`);
    stop();
    process.exit(1);
  }
  line(true, 'worker started');

  const res = await fetch(`http://127.0.0.1:${PORT}/v1/summary/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(5_000),
  });

  let failures = 0;

  if (!res.ok) {
    line(false, 'POST /v1/summary/generate', `HTTP ${res.status}`);
    failures += 1;
  } else {
    line(true, 'POST /v1/summary/generate');

    const body: unknown = await res.json();
    const parsed = clinicalDraftSchema.safeParse(body);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      line(false, 'response matches the draft contract', where);
      failures += 1;
    } else {
      line(true, 'response matches the draft contract');

      const verdict = validateDraft(parsed.data, material);
      if (!verdict.ok) {
        const why = verdict.problems.map((p) => `${p.where} ${p.code}`).join('; ');
        line(false, 'response passes the safety validator', why);
        failures += 1;
      } else {
        line(true, 'response passes the safety validator');
        line(true, `${verdict.draft.sections.length} sections, grounded and labelled`);
      }
    }
  }

  // No ASR or OCR engine ships. These must refuse rather than return invented clinical
  // detail with a confidence score attached, which is what they used to do.
  for (const path of ['/v1/speech/transcribe', '/v1/ocr/extract']) {
    const refusal = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    if (refusal.status === 501) {
      line(true, `POST ${path} refuses`);
    } else {
      line(false, `POST ${path} refuses`, `HTTP ${refusal.status}, expected 501`);
      failures += 1;
    }
  }

  stop();
  process.stdout.write(
    failures === 0
      ? '\nai_worker contract: ok\n\n'
      : `\nai_worker contract: ${failures} problem(s)\n\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
