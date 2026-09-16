-- 0026 — a third reason to be at an OPD.
--
-- `visit_type` had two values: NEW_COMPLAINT and REGULAR_FOLLOW_UP. A patient who has come
-- for neither — a general check-up, or a first visit with nothing wrong — had to be
-- recorded as a new complaint, which is a clinical untruth in the one field the doctor uses
-- to decide whether to read a follow-up delta or take a history from scratch.
--
-- The walk-in kiosk made this worse by hardcoding NEW_COMPLAINT for every visit it opened,
-- so the distinction did not exist in practice and the follow-up flow built in Phase 12 was
-- unreachable from the kiosk at all.

-- Up Migration

ALTER TYPE visit_type ADD VALUE IF NOT EXISTS 'GENERAL_CHECKUP';

-- Down Migration

-- PostgreSQL cannot remove a value from an enum type. Rolling back would mean recreating
-- the type and rewriting every column that uses it, which would take an ACCESS EXCLUSIVE
-- lock on `pre_checkin` and `encounter` and rewrite both tables — and would fail outright
-- if any row already used the value. An additive enum value is safe to leave in place: no
-- code is obliged to produce it, and this down migration says so rather than pretending.
SELECT 1;
