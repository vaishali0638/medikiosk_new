-- 0009 — a separate handle for a confirmed arrival.
--
-- A QR payload is signed, not encrypted: anyone who photographs the code in a waiting
-- room can base64-decode it and read the pre-check-in id. If that id were also the handle
-- used to confirm the arrival and request a token, a bystander could drive the rest of
-- the journey for a visit that is not theirs.
--
-- The kiosk therefore learns a fresh random handle only as the result of a successful
-- scan, and every later call in the arrival flow addresses that instead.

-- Up Migration

ALTER TABLE pre_checkin ADD COLUMN arrival_handle uuid UNIQUE;
ALTER TABLE pre_checkin ADD COLUMN arrival_handle_expires_at timestamptz;

ALTER TABLE pre_checkin ADD CONSTRAINT pre_checkin_arrival_handle_has_expiry CHECK (
  (arrival_handle IS NULL) = (arrival_handle_expires_at IS NULL)
);

CREATE INDEX pre_checkin_arrival_handle_idx ON pre_checkin (arrival_handle)
  WHERE arrival_handle IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS pre_checkin_arrival_handle_idx;
ALTER TABLE pre_checkin DROP CONSTRAINT IF EXISTS pre_checkin_arrival_handle_has_expiry;
ALTER TABLE pre_checkin DROP COLUMN IF EXISTS arrival_handle_expires_at;
ALTER TABLE pre_checkin DROP COLUMN IF EXISTS arrival_handle;
