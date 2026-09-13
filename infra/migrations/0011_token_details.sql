-- 0011 — the details a hospital returns alongside a token, and handle rotation.
--
-- Two additions the token flow needs.
--
-- 1. A token on its own does not tell a patient where to go. The HIS returns a room and a
--    queue position with it; storing them means the screen can be redrawn, and the
--    printer re-run, without asking the hospital again.
--
-- 2. Phase 6 spent the arrival handle on confirmation, because the flow ended there. It
--    does not: requesting a token is a third step. Rather than fall back to addressing
--    the visit by its pre-check-in id — which anyone who photographed the QR can read —
--    the handle is now ROTATED at each step, so the value used to confirm cannot also be
--    used to request a token.

-- Up Migration

ALTER TABLE token_request ADD COLUMN room text;
ALTER TABLE token_request ADD COLUMN queue_status text;
-- Round-trip time to the hospital system, for the latency budget in the ops dashboard.
ALTER TABLE token_request ADD COLUMN last_latency_ms integer
  CHECK (last_latency_ms IS NULL OR last_latency_ms >= 0);

-- Down Migration

ALTER TABLE token_request DROP COLUMN IF EXISTS last_latency_ms;
ALTER TABLE token_request DROP COLUMN IF EXISTS queue_status;
ALTER TABLE token_request DROP COLUMN IF EXISTS room;
