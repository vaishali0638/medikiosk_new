// GENERATED FILE — DO NOT EDIT.
// Source: packages/terminology/src/languages.ts
// Regenerate with: npm run build -w @medikiosk/terminology

import 'dart:ui' show TextDirection;

import 'package:flutter/foundation.dart';

/// One language the platform knows the name, script and reading direction of.
///
/// Presence here is not permission to offer it. See the registry's own header: the
/// clinical review, the published consent notice and the available voice are separate
/// gates, checked elsewhere.
@immutable
class IndianLanguage {
  const IndianLanguage({
    required this.tag,
    required this.endonym,
    required this.englishName,
    required this.script,
    required this.direction,
    required this.eighthSchedule,
  });

  /// BCP-47 tag.
  final String tag;

  /// The language's name in its own script — what the patient reads.
  final String endonym;

  /// The English name, for staff screens and logs only.
  final String englishName;

  /// ISO 15924 script code.
  final String script;

  final TextDirection direction;

  /// Whether the language is in the Eighth Schedule to the Constitution.
  final bool eighthSchedule;

  /// Whether this script needs a font bundled with the build to render at all.
  bool get needsBundledFont => kScriptsNeedingBundledFont.contains(script);
}

const List<String> kScriptsNeedingBundledFont = <String>['Mtei', 'Olck'];

const List<IndianLanguage> kIndianLanguages = <IndianLanguage>[
  IndianLanguage(
    tag: 'as',
    endonym: 'অসমীয়া',
    englishName: 'Assamese',
    script: 'Beng',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'bn',
    endonym: 'বাংলা',
    englishName: 'Bengali',
    script: 'Beng',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'brx',
    endonym: 'बड़ो',
    englishName: 'Bodo',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'doi',
    endonym: 'डोगरी',
    englishName: 'Dogri',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'en',
    endonym: 'English',
    englishName: 'English',
    script: 'Latn',
    direction: TextDirection.ltr,
    eighthSchedule: false,
  ),
  IndianLanguage(
    tag: 'gu',
    endonym: 'ગુજરાતી',
    englishName: 'Gujarati',
    script: 'Gujr',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'hi',
    endonym: 'हिन्दी',
    englishName: 'Hindi',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'kn',
    endonym: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    script: 'Knda',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'ks',
    endonym: 'کٲشُر',
    englishName: 'Kashmiri',
    script: 'Arab',
    direction: TextDirection.rtl,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'kok',
    endonym: 'कोंकणी',
    englishName: 'Konkani',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'mai',
    endonym: 'मैथिली',
    englishName: 'Maithili',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'ml',
    endonym: 'മലയാളം',
    englishName: 'Malayalam',
    script: 'Mlym',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'mni',
    endonym: 'ꯃꯤꯇꯩꯂꯣꯟ',
    englishName: 'Manipuri',
    script: 'Mtei',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'mr',
    endonym: 'मराठी',
    englishName: 'Marathi',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'ne',
    endonym: 'नेपाली',
    englishName: 'Nepali',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'or',
    endonym: 'ଓଡ଼ିଆ',
    englishName: 'Odia',
    script: 'Orya',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'pa',
    endonym: 'ਪੰਜਾਬੀ',
    englishName: 'Punjabi',
    script: 'Guru',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'sa',
    endonym: 'संस्कृतम्',
    englishName: 'Sanskrit',
    script: 'Deva',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'sat',
    endonym: 'ᱥᱟᱱᱛᱟᱲᱤ',
    englishName: 'Santali',
    script: 'Olck',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'sd',
    endonym: 'سنڌي',
    englishName: 'Sindhi',
    script: 'Arab',
    direction: TextDirection.rtl,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'ta',
    endonym: 'தமிழ்',
    englishName: 'Tamil',
    script: 'Taml',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'te',
    endonym: 'తెలుగు',
    englishName: 'Telugu',
    script: 'Telu',
    direction: TextDirection.ltr,
    eighthSchedule: true,
  ),
  IndianLanguage(
    tag: 'ur',
    endonym: 'اردو',
    englishName: 'Urdu',
    script: 'Arab',
    direction: TextDirection.rtl,
    eighthSchedule: true,
  ),
];

final Map<String, IndianLanguage> _byTag = <String, IndianLanguage>{
  for (final IndianLanguage l in kIndianLanguages) l.tag: l,
};

IndianLanguage? findLanguage(String tag) => _byTag[tag];

bool isKnownLanguage(String tag) => _byTag.containsKey(tag);
