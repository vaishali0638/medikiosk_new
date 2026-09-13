-- 0010 — a kiosk may be recorded before the arrival is confirmed.
--
-- Phase 2 wrote `(arrival_confirmed_at IS NULL) = (arrival_kiosk_id IS NULL)`, on the
-- assumption that a patient arriving and confirming were one event. Building the real
-- flow showed they are two: the QR is scanned at a kiosk, masked details are shown, and
-- only then does the patient confirm the visit is theirs. Between those moments the
-- device is known and the confirmation is not.
--
-- The guarantee that actually matters is one-directional, and is preserved: a CONFIRMED
-- arrival must name the kiosk it happened at. Recording the device earlier is not a
-- weakening — it means an abandoned scan is still attributable.

-- Up Migration

ALTER TABLE pre_checkin DROP CONSTRAINT pre_checkin_arrival_needs_kiosk;
ALTER TABLE pre_checkin ADD CONSTRAINT pre_checkin_arrival_needs_kiosk CHECK (
  arrival_confirmed_at IS NULL OR arrival_kiosk_id IS NOT NULL
);

-- Down Migration

ALTER TABLE pre_checkin DROP CONSTRAINT pre_checkin_arrival_needs_kiosk;
ALTER TABLE pre_checkin ADD CONSTRAINT pre_checkin_arrival_needs_kiosk CHECK (
  (arrival_confirmed_at IS NULL) = (arrival_kiosk_id IS NULL)
);
