-- 0015 — what a stored original needs to be retrievable, and what an OCR job needs to be
-- retryable.

-- Up Migration

-- Names the key the object was encrypted with, so keys can be rotated without making
-- every previously stored document unreadable.
ALTER TABLE document ADD COLUMN encryption_key_id text;
-- The filename the patient's device supplied. Untrusted, stored for the doctor's benefit
-- only, and never used to build a path.
ALTER TABLE document ADD COLUMN original_filename text;
-- Why a file was refused. Structured, so the ops dashboard can distinguish "wrong type"
-- from "failed the malware scan".
ALTER TABLE document ADD COLUMN rejection_reason text;

ALTER TABLE document ADD CONSTRAINT document_stored_is_encrypted CHECK (
  state <> 'STORED' OR encryption_key_id IS NOT NULL
);
ALTER TABLE document ADD CONSTRAINT document_rejected_has_reason CHECK (
  state NOT IN ('REJECTED_MALWARE', 'REJECTED_INVALID') OR rejection_reason IS NOT NULL
);

-- The extraction row doubles as the job record: a database-backed queue, which at kiosk
-- volumes is simpler than a broker and survives a restart without extra machinery.
ALTER TABLE ocr_extraction ADD COLUMN attempt_count integer NOT NULL DEFAULT 0
  CHECK (attempt_count >= 0);
ALTER TABLE ocr_extraction ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ocr_extraction ADD COLUMN last_error_code text;
-- Set while a worker holds the job, so two workers cannot process it at once.
ALTER TABLE ocr_extraction ADD COLUMN claimed_at timestamptz;
ALTER TABLE ocr_extraction ADD COLUMN claimed_by text;

CREATE INDEX ocr_extraction_due_idx ON ocr_extraction (next_attempt_at)
  WHERE review_state = 'PENDING';

-- Down Migration

DROP INDEX IF EXISTS ocr_extraction_due_idx;
ALTER TABLE ocr_extraction DROP COLUMN IF EXISTS claimed_by;
ALTER TABLE ocr_extraction DROP COLUMN IF EXISTS claimed_at;
ALTER TABLE ocr_extraction DROP COLUMN IF EXISTS last_error_code;
ALTER TABLE ocr_extraction DROP COLUMN IF EXISTS next_attempt_at;
ALTER TABLE ocr_extraction DROP COLUMN IF EXISTS attempt_count;

ALTER TABLE document DROP CONSTRAINT IF EXISTS document_rejected_has_reason;
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_stored_is_encrypted;
ALTER TABLE document DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE document DROP COLUMN IF EXISTS original_filename;
ALTER TABLE document DROP COLUMN IF EXISTS encryption_key_id;
