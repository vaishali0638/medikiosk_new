-- 0027 — record which system verified a one-time code.
--
-- Until now there was one answer: this service generated the code, stored an HMAC of it,
-- and checked it locally. `code_hash` and `code_key_id` were therefore always meaningful.
--
-- With Supabase Auth as the transport, the code is generated and checked by Supabase and
-- this service never sees it — so there is nothing to hash, and a row with an empty
-- `code_hash` would otherwise be indistinguishable from a bug. Saying plainly which system
-- vouched for a verification is also the honest thing for the audit trail: "a code was
-- verified" means something different when a third party did the verifying.

-- Up Migration

CREATE TYPE otp_verifier AS ENUM ('LOCAL', 'SUPABASE');

ALTER TABLE otp_verification
  ADD COLUMN verifier otp_verifier NOT NULL DEFAULT 'LOCAL';

-- A locally verified code must have a hash to have been checked against. An externally
-- verified one must not pretend to: an empty string there would read as a stored secret.
ALTER TABLE otp_verification ADD CONSTRAINT otp_verification_hash_matches_verifier CHECK (
  (verifier = 'LOCAL' AND length(code_hash) > 0)
  OR (verifier = 'SUPABASE' AND code_hash = '')
);

-- Down Migration

ALTER TABLE otp_verification DROP CONSTRAINT IF EXISTS otp_verification_hash_matches_verifier;
ALTER TABLE otp_verification DROP COLUMN IF EXISTS verifier;
DROP TYPE IF EXISTS otp_verifier;
