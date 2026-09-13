# Phase 10 — Documents and OCR

A patient arrives holding a plastic folder of prescriptions, lab slips and a discharge
summary from another hospital. This phase takes photographs of those papers, keeps them
safely, and reads them **as suggestions for a clinician to check** — never as facts.

The one-sentence rule for the whole phase:

> **Never automatically update active medication, allergy, diagnosis or prescription
> records from OCR.**

Everything below is in service of making that true by construction rather than by
discipline.

## Extraction is a candidate, not a record

`ocr_extraction` is a table of _candidates_. Its `review_state` walks
`PENDING → AWAITING_CLINICIAN_REVIEW`, and the service **cannot** move it further: there
is no code path in this phase that writes a verified state, because verification is a
clinician's act in Phase 11's review surface, not a worker's.

Every extracted field carries the literal label `OCR-EXTRACTED — VERIFY` alongside its
value, and fields below `0.85` confidence are additionally flagged one by one. A field at
`0.99` is labelled exactly as loudly as one at `0.40`, because the danger is not low
confidence — a doctor distrusts a garbled reading on sight. The danger is a _confident,
plausible, wrong_ reading of a handwritten dose, and no confidence score distinguishes
that from a correct one.

An integration test asserts the negative directly: after a full extraction cycle over a
prescription, no row exists in any medication, allergy or diagnosis table.

## Order of operations on upload

Consent → validate → scan → encrypt → store bytes → **write the row last**.

The row is written last on purpose. A `document` row that exists before its bytes do is a
record of a document nobody can produce; a clinician opening it gets an error where they
expected a prescription, and cannot tell whether the patient uploaded nothing or the
system lost it. Storing first means a row always has bytes behind it, and a crash leaves
an orphaned object rather than a phantom record.

A rejected file _does_ get a row — with `state = REJECTED_MALWARE` or `REJECTED_INVALID`,
`encryption_key_id` null and no object at all. A pattern of refusals at one kiosk is worth
seeing.

## What a kiosk is allowed to know

The device is the one part of this system an attacker can physically touch, standing in a
public waiting room. So the kiosk-facing list endpoint withholds two fields the row does
carry:

- **`rejection_reason`** — which check caught a file (magic bytes, size, EICAR) is exactly
  the feedback someone probing the uploader needs to tune around it. The patient sees
  "not accepted"; the reason stays in the audit log.
- **`overall_confidence`** — a client that can see confidence can rank extractions and
  present the confident ones as settled. That is the failure this phase exists to prevent,
  so the number does not leave the server.

Both are pinned by an integration test that asserts the properties are absent from the
response.

## Storage

Application-level **AES-256-GCM**, keyed by `OBJECT_ENCRYPTION_KEY` and tagged with a key
id, so the storage operator holds ciphertext and nothing else. Layout on disk is
`iv ‖ tag ‖ ciphertext`.

The SHA-256 is taken over the **plaintext, before encryption**. That is the hash a
clinician can reproduce from the file they downloaded, and it is what `readOriginal`
re-computes after decrypting: if the digest does not match, the document is refused rather
than served. GCM's auth tag already makes silent tampering impossible — a modified
ciphertext throws on decrypt — so the hash check is the second, independent statement that
the bytes are the ones the patient handed over.

Originals are served `Content-Disposition: attachment` with `X-Content-Type-Options:
nosniff` and `Cache-Control: no-store`, so a crafted upload cannot execute in a viewer's
context.

## Validation, and failing closed

Content type is checked against **magic bytes**, not the declared header — a `%PDF` body
uploaded as `image/jpeg` is refused. Size is bounded before decoding.

`MALWARE_SCANNER` selects the scanner. The heuristic one catches EICAR and the PDF
constructs that make a document active (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`).
When nothing is configured, `UnconfiguredMalwareScanner` **refuses every upload**. A
misconfigured deployment that quietly accepted unscanned files would be worse than one
that visibly accepts none.

## The queue

`ocr_extraction` doubles as the job table, claimed with `FOR UPDATE SKIP LOCKED` and a
five-minute lease so a worker that dies mid-job does not strand its document. Retries back
off; after the last attempt the row goes to `FAILED` — **and the original is still there**,
which is the state that actually matters. Extraction runs asynchronously and never blocks
a token.

No OCR engine ships here. The extractor is an interface; the pipeline, the states, the
labelling and the retry behaviour are what this phase verifies.

## The kiosk screens

Four, from master prompt §12: add previous records, document type, image quality, OCR
status. Per the specification these carry **no staff-help button and no retry assistance** —
the image-quality screen is `Use this image` or `Exit`, and a test asserts that those are
the only two buttons on it.

Three decisions in the UI worth naming:

**Capture routes are gated on hardware.** A `Use scanner` button on a kiosk without a
scanner sends a patient off to find staff about something that will never work there.
`Upload file` is off by default: a device in lock-task mode has no file browser to pick
from.

**"I have no documents" is a declaration, not a skip.** Most patients at a government OPD
arrive with nothing, and a screen that treats that as an omission makes them feel they
failed at something. It is the primary action when nothing is attached — which is a
deliberate departure from the specification's mock-up, where `[I have no documents]` and
`[Continue]` both appear. Offering both at once is contradictory, and one primary action
per screen is a design-system rule from Phase 1.

**The OCR status screen shows no extracted text and no confidence.** Showing a patient what
was read invites them to believe it, or to correct it into the record. Neither is theirs to
do. They see a count, a per-document state, and the two sentences the specification
prescribes: the originals are saved, and the doctor verifies what was extracted. A _failed_
extraction is not shown as a failure either — "saved — the doctor will read it" is both
true and the patient's actual situation.

## Tests

| Suite                                    | Count |
| ---------------------------------------- | ----- |
| `src/documents/` unit                    | 23    |
| `test/documents.int-spec.ts` integration | 19    |
| `test/document_screens_test.dart` widget | 14    |

Full suites at the end of this phase: **130 backend unit, 247 backend integration, 218
Flutter**.

Walked end to end against `dist/main.js`: a clean JPEG uploads and queues extraction; the
bytes on disk are ciphertext (54 bytes for 26 of plaintext) with no plaintext present; the
original round-trips exactly; EICAR is refused, recorded and never stored; the audit trail
shows `DOCUMENT_STORED` and `DOCUMENT_REJECTED`.

## Known limitations

- **No OCR engine.** The extractor interface is implemented by a stub; a real one (and the
  handwriting problem behind it) is hospital-specific work.
- **No worker process.** Jobs are claimed correctly and tested, but nothing runs a loop
  yet — that lands with the AI worker service.
- **The image-quality checks are not implemented.** The screen renders the problems it is
  given; nothing yet computes blur, glare or a missing edge from a photograph.
- **The kiosk journey still does not wire these screens together**, along with AYUSH
  selection and intake, and the demographics form outstanding since Phase 5.
- **Local filesystem object store only.** MinIO/S3 is an adapter swap behind
  `ObjectStore`, not a rewrite, but it has not been written.

## Exit criteria

| Criterion                                             | Status                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Originals stored securely and hashed                  | Verified — AES-256-GCM, SHA-256 over plaintext, re-checked on read               |
| Uploads validated and malware-scanned                 | Verified — magic bytes, size bound, EICAR and active-PDF constructs, fail-closed |
| OCR output is a review candidate, never a record      | Verified — `AWAITING_CLINICIAN_REVIEW` is the terminal state this phase can set  |
| No clinical record is written from extraction         | Verified — asserted as a negative over medication, allergy and diagnosis tables  |
| Extraction is asynchronous and never blocks the token | Verified — queued in the upload transaction; Continue is live while pending      |
| Every extracted field is labelled for verification    | Verified — `OCR-EXTRACTED — VERIFY` on every field, low confidence flagged too   |
