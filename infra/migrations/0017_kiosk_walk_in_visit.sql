-- 0017 — a visit opened at the kiosk by a patient who arrived without a mobile
-- pre-check-in.

-- Up Migration

-- Which kiosk session opened this visit. Null for every mobile pre-check-in, which is the
-- overwhelmingly common case and the reason this is nullable rather than a second table:
-- a clinician should not be able to tell from the record which door the patient came
-- through, and a parallel table would mean every downstream query needed two branches —
-- the kind of duplication where one branch quietly stops getting the safety checks.
ALTER TABLE pre_checkin ADD COLUMN kiosk_session_id uuid REFERENCES kiosk_session (id);

-- One walk-in visit per session. A kiosk that retries a timed-out request, or a patient
-- who backs up and comes forward again, must not end up with two intakes and eventually
-- two tokens. Partial, so the many mobile pre-check-ins with a null session are unaffected.
CREATE UNIQUE INDEX pre_checkin_one_per_kiosk_session
  ON pre_checkin (kiosk_session_id)
  WHERE kiosk_session_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS pre_checkin_one_per_kiosk_session;
ALTER TABLE pre_checkin DROP COLUMN IF EXISTS kiosk_session_id;
