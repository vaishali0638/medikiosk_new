/**
 * The languages a MediKiosk may be configured to offer.
 *
 * SCOPE: the twenty-two languages of the Eighth Schedule to the Constitution of India,
 * plus English. That set is chosen rather than "every language spoken in India" because
 * it is the one a government hospital can be held to: it is enumerated in law, it is what
 * the Department of Official Language publishes in, and it is a closed list, so "all
 * regional languages" is a checkable claim rather than an aspiration.
 *
 * India has several hundred other languages, some with more speakers than the smaller
 * Schedule entries. A hospital serving one of them adds it here with the same evidence any
 * other language needs — an endonym, a script and a reviewer — rather than being told the
 * platform does not support it.
 *
 * WHAT THIS FILE IS NOT: it is not permission to show a language to a patient. Listing a
 * language here says the platform knows its name, script and reading direction. Whether a
 * kiosk offers it depends on `hospital_language.clinically_reviewed`, on a published
 * consent notice in that language, and — for spoken guidance — on a voice the device can
 * actually produce. Those are three separate gates and this registry passes none of them.
 */

/** ISO 15924 script code. Determines font coverage and reading direction. */
export type ScriptCode =
  | 'Arab'
  | 'Beng'
  | 'Deva'
  | 'Gujr'
  | 'Guru'
  | 'Knda'
  | 'Latn'
  | 'Mlym'
  | 'Mtei'
  | 'Olck'
  | 'Orya'
  | 'Taml'
  | 'Telu';

export type TextDirection = 'ltr' | 'rtl';

export interface LanguageEntry {
  /** BCP-47 tag. Two-letter ISO 639-1 where one exists, ISO 639-3 otherwise. */
  readonly tag: string;
  /**
   * The name of the language IN that language, in its own script.
   *
   * This is what the selection screen shows. A patient who reads only Odia cannot find
   * "Odia" in a list written in Latin script, so the endonym is the label and the English
   * name is only ever a secondary annotation for staff and logs.
   */
  readonly endonym: string;
  /** The English name, for staff-facing screens, logs and runbooks. */
  readonly englishName: string;
  readonly script: ScriptCode;
  readonly direction: TextDirection;
  /** Whether the language is in the Eighth Schedule. English is not; it is added by policy. */
  readonly eighthSchedule: boolean;
}

/**
 * Ordered by English name so the registry reads predictably. Display order on the kiosk is
 * a separate decision made per hospital — a district hospital in Thrissur should not show
 * Assamese first because the alphabet says so.
 */
export const LANGUAGES: readonly LanguageEntry[] = [
  {
    tag: 'as',
    endonym: 'অসমীয়া',
    englishName: 'Assamese',
    script: 'Beng',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'bn',
    endonym: 'বাংলা',
    englishName: 'Bengali',
    script: 'Beng',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'brx',
    endonym: 'बड़ो',
    englishName: 'Bodo',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'doi',
    endonym: 'डोगरी',
    englishName: 'Dogri',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'en',
    endonym: 'English',
    englishName: 'English',
    script: 'Latn',
    direction: 'ltr',
    eighthSchedule: false,
  },
  {
    tag: 'gu',
    endonym: 'ગુજરાતી',
    englishName: 'Gujarati',
    script: 'Gujr',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'hi',
    endonym: 'हिन्दी',
    englishName: 'Hindi',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'kn',
    endonym: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    script: 'Knda',
    direction: 'ltr',
    eighthSchedule: true,
  },
  // Kashmiri is written in Perso-Arabic in Jammu and Kashmir and in Devanagari by some
  // communities. The Perso-Arabic form is the official one, so it is the registry's, and a
  // hospital needing the Devanagari form registers it explicitly rather than by guesswork.
  {
    tag: 'ks',
    endonym: 'کٲشُر',
    englishName: 'Kashmiri',
    script: 'Arab',
    direction: 'rtl',
    eighthSchedule: true,
  },
  {
    tag: 'kok',
    endonym: 'कोंकणी',
    englishName: 'Konkani',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'mai',
    endonym: 'मैथिली',
    englishName: 'Maithili',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'ml',
    endonym: 'മലയാളം',
    englishName: 'Malayalam',
    script: 'Mlym',
    direction: 'ltr',
    eighthSchedule: true,
  },
  // Meetei Mayek is the official script of Manipur. Manipuri is also written in Bengali
  // script, and a device without a Meetei Mayek font renders this as boxes — which is why
  // font coverage is checked per script rather than assumed.
  {
    tag: 'mni',
    endonym: 'ꯃꯤꯇꯩꯂꯣꯟ',
    englishName: 'Manipuri',
    script: 'Mtei',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'mr',
    endonym: 'मराठी',
    englishName: 'Marathi',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'ne',
    endonym: 'नेपाली',
    englishName: 'Nepali',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'or',
    endonym: 'ଓଡ଼ିଆ',
    englishName: 'Odia',
    script: 'Orya',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'pa',
    endonym: 'ਪੰਜਾਬੀ',
    englishName: 'Punjabi',
    script: 'Guru',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'sa',
    endonym: 'संस्कृतम्',
    englishName: 'Sanskrit',
    script: 'Deva',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'sat',
    endonym: 'ᱥᱟᱱᱛᱟᱲᱤ',
    englishName: 'Santali',
    script: 'Olck',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'sd',
    endonym: 'سنڌي',
    englishName: 'Sindhi',
    script: 'Arab',
    direction: 'rtl',
    eighthSchedule: true,
  },
  {
    tag: 'ta',
    endonym: 'தமிழ்',
    englishName: 'Tamil',
    script: 'Taml',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'te',
    endonym: 'తెలుగు',
    englishName: 'Telugu',
    script: 'Telu',
    direction: 'ltr',
    eighthSchedule: true,
  },
  {
    tag: 'ur',
    endonym: 'اردو',
    englishName: 'Urdu',
    script: 'Arab',
    direction: 'rtl',
    eighthSchedule: true,
  },
] as const;

export const LANGUAGE_TAGS: readonly string[] = LANGUAGES.map((l) => l.tag);

const BY_TAG = new Map<string, LanguageEntry>(LANGUAGES.map((l) => [l.tag, l]));

export function findLanguage(tag: string): LanguageEntry | undefined {
  return BY_TAG.get(tag);
}

export function isKnownLanguage(tag: string): boolean {
  return BY_TAG.has(tag);
}

/**
 * Scripts that need a font shipped with the kiosk build.
 *
 * Android's default font set covers Devanagari, Bengali, Gujarati, Gurmukhi, Kannada,
 * Malayalam, Odia, Tamil, Telugu and Arabic. It does not reliably cover Meetei Mayek or
 * Ol Chiki, so Manipuri and Santali render as tofu boxes on a stock device. A language
 * whose script has no font is worse than one that is absent: the patient sees a row of
 * empty rectangles and concludes the kiosk is broken.
 */
export const SCRIPTS_NEEDING_BUNDLED_FONT: readonly ScriptCode[] = ['Mtei', 'Olck'];
