-- 0024 — a language a patient can be offered must be a language the platform knows.
--
-- `hospital_language.language_tag` was `text CHECK (length BETWEEN 2 AND 16)`. That accepts
-- 'tamil', 'TA', 'ta-IN', 'tm' and a typo, all as distinct languages, and every one of them
-- would then be looked up for a consent notice, a questionnaire translation and a voice —
-- and quietly find nothing. The failure surfaces as a language that appears on the kiosk
-- and does nothing when a patient touches it.
--
-- This table is the canonical set: the twenty-two languages of the Eighth Schedule plus
-- English. Its source of truth is `packages/terminology/src/languages.ts`, and
-- `test/schema-parity.int-spec.ts` fails if the two drift apart, so this cannot rot into a
-- second, older copy of the list.
--
-- Being in this table grants nothing. It records that the platform knows the language's
-- name, script and reading direction. Whether a kiosk OFFERS it still requires
-- `clinically_reviewed`, a published consent notice in that language, and — for spoken
-- guidance — a voice the device actually has.

-- Up Migration

CREATE TABLE language (
  tag             text PRIMARY KEY CHECK (length(tag) BETWEEN 2 AND 16),
  -- The language's name in its own script. This is what a patient reads on the selection
  -- screen; the English name is for staff, logs and runbooks.
  endonym         text NOT NULL,
  english_name    text NOT NULL,
  -- ISO 15924. Determines font coverage: a script with no font renders as empty boxes.
  script          text NOT NULL CHECK (length(script) = 4),
  direction       text NOT NULL CHECK (direction IN ('ltr', 'rtl')),
  eighth_schedule boolean NOT NULL
);

INSERT INTO language (tag, endonym, english_name, script, direction, eighth_schedule) VALUES
  ('as', 'অসমীয়া', 'Assamese', 'Beng', 'ltr', true),
  ('bn', 'বাংলা', 'Bengali', 'Beng', 'ltr', true),
  ('brx', 'बड़ो', 'Bodo', 'Deva', 'ltr', true),
  ('doi', 'डोगरी', 'Dogri', 'Deva', 'ltr', true),
  ('en', 'English', 'English', 'Latn', 'ltr', false),
  ('gu', 'ગુજરાતી', 'Gujarati', 'Gujr', 'ltr', true),
  ('hi', 'हिन्दी', 'Hindi', 'Deva', 'ltr', true),
  ('kn', 'ಕನ್ನಡ', 'Kannada', 'Knda', 'ltr', true),
  ('ks', 'کٲشُر', 'Kashmiri', 'Arab', 'rtl', true),
  ('kok', 'कोंकणी', 'Konkani', 'Deva', 'ltr', true),
  ('mai', 'मैथिली', 'Maithili', 'Deva', 'ltr', true),
  ('ml', 'മലയാളം', 'Malayalam', 'Mlym', 'ltr', true),
  ('mni', 'ꯃꯤꯇꯩꯂꯣꯟ', 'Manipuri', 'Mtei', 'ltr', true),
  ('mr', 'मराठी', 'Marathi', 'Deva', 'ltr', true),
  ('ne', 'नेपाली', 'Nepali', 'Deva', 'ltr', true),
  ('or', 'ଓଡ଼ିଆ', 'Odia', 'Orya', 'ltr', true),
  ('pa', 'ਪੰਜਾਬੀ', 'Punjabi', 'Guru', 'ltr', true),
  ('sa', 'संस्कृतम्', 'Sanskrit', 'Deva', 'ltr', true),
  ('sat', 'ᱥᱟᱱᱛᱟᱲᱤ', 'Santali', 'Olck', 'ltr', true),
  ('sd', 'سنڌي', 'Sindhi', 'Arab', 'rtl', true),
  ('ta', 'தமிழ்', 'Tamil', 'Taml', 'ltr', true),
  ('te', 'తెలుగు', 'Telugu', 'Telu', 'ltr', true),
  ('ur', 'اردو', 'Urdu', 'Arab', 'rtl', true);

-- Existing rows are 'en' and 'hi', both present above, so this validates without a backfill.
ALTER TABLE hospital_language
  ADD CONSTRAINT hospital_language_tag_known
  FOREIGN KEY (language_tag) REFERENCES language(tag) ON DELETE RESTRICT;

-- Down Migration

ALTER TABLE hospital_language DROP CONSTRAINT hospital_language_tag_known;
DROP TABLE IF EXISTS language;
