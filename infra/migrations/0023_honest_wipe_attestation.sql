-- 0023 — stop recording a wipe the server cannot know happened.
--
-- `kiosk_session_ended_is_wiped` (migration 0004) required `wiped_at` on every EXITED or
-- EXPIRED session. That is right for EXITED: the client ends the session and attests, in
-- the same statement, that it cleared its own buffers — and a client that does not attest
-- fails loudly, which is the control working.
--
-- It is wrong for EXPIRED. `expireAbandoned` runs server-side precisely for the sessions
-- whose device never got to run its timer — it crashed, or lost power. The constraint left
-- that sweep no choice but to write `wiped_at = now()`, so the field recorded a wipe
-- attestation for exactly the sessions least likely to have been wiped.
--
-- The consequence was not theoretical: a monitor for "ended without a wipe attestation"
-- could never fire, because the state was being papered over rather than prevented.

-- Up Migration

ALTER TABLE kiosk_session DROP CONSTRAINT kiosk_session_ended_is_wiped;

-- A client-ended session must still attest. A server-expired one records what is true:
-- nothing confirmed the wipe, and an operator should know.
ALTER TABLE kiosk_session ADD CONSTRAINT kiosk_session_exit_is_wiped CHECK (
  state <> 'EXITED' OR wiped_at IS NOT NULL
);

-- Down Migration

ALTER TABLE kiosk_session DROP CONSTRAINT IF EXISTS kiosk_session_exit_is_wiped;
ALTER TABLE kiosk_session ADD CONSTRAINT kiosk_session_ended_is_wiped CHECK (
  state NOT IN ('EXITED', 'EXPIRED') OR wiped_at IS NOT NULL
);
