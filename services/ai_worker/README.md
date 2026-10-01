# ai_worker

Python service for the pre-consultation draft. Phases 10 and 11 specify ASR, TTS, OCR,
extraction and confidence scoring alongside it; **none of those ship here.**

## What works

`POST /v1/summary/generate` — assembles a pre-consultation draft from the structured
answers and document labels core_api sends it, and returns it in the shape
`services/core_api/src/summary/draft.contract.ts` requires.

It is not a language model. It restates answers; it infers nothing. That is deliberate and
it is what lets the draft pass the safety gate: every statement is a quoted restatement of
one answer, carrying that answer's provenance and the id of the question it came from, so
there is no vocabulary in the output the patient did not supply.

The three properties core_api enforces, and the reason each is in the response:

| Requirement                         | Why it is not optional                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `provenance` on every statement     | An unlabelled claim in a clinical record is the failure this whole scheme prevents      |
| `sourceRef` on every statement      | The grounding check ties each statement back to a question; untraceable text is dropped |
| Patient's words **quoted**          | Quoted spans are exempt from the banned-language scan, so symptoms survive verbatim     |
| `NO_DIAGNOSIS_STATEMENT` verbatim   | Checked by string match in the narrative                                                |

The provenance labels and the disclaimer are copied from `packages/terminology`, where
they are the source of truth. The em dash in `OCR-EXTRACTED — VERIFY` is load-bearing.

## What refuses

`POST /v1/ocr/extract` and `POST /v1/speech/transcribe` answer **501**. There is no OCR
engine and no ASR model in this repository.

They previously returned HTTP 200 with a fixed payload for any input — a transcript of
"chest pain since morning" at confidence 0.94, an extracted "Metformin 500mg" at 0.91.
Nothing called them, but invented clinical detail carrying a high confidence score is the
most dangerous thing this service could return: the confidence is what a reviewer uses to
decide how hard to look, and a caller cannot tell it from a real extraction. A refusal that
names the gap is the answer the rest of the codebase gives for an unconfigured dependency.

`FEATURE_OCR` and `FEATURE_VOICE_INTAKE` default to off. Turning either on needs a real
engine, not a stand-in.

## Running it

```bash
python3 services/ai_worker/server.py 8000   # no dependencies beyond the standard library
```

`npm start` starts it automatically when `python3` is present and points core_api at it.
To run core_api against it by hand, set `AI_WORKER_URL=http://localhost:8000`.

Leaving `AI_WORKER_URL` unset is a supported configuration, not a degraded one: core_api
composes the draft in-process and the same safety validator judges it. core_api also falls
back to that path whenever the worker is slow, unreachable, or returns something outside
the contract — so a broken worker costs a log line, never a patient's draft.

## Checking it

```bash
npm run aiworker:check
```

Starts the worker, sends a sample intake, and validates the response against both the draft
schema and the full safety validator — then checks that OCR and transcription still refuse.
CI runs this, because `tsc` cannot see across the Python boundary and a worker that drifts
out of the contract fails silently: core_api discards every response and composes locally
while the worker's own health check stays green.
