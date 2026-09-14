import 'package:flutter/foundation.dart';

import 'kiosk_strings.g.dart';

/// Shell strings for the kiosk chrome.
///
/// SCOPE: navigation and system text only — screen titles, buttons, error and timeout
/// wording. No clinical content appears here.
///
/// Clinical text (consent notices, questions, answer options, red-flag wording) is
/// GOVERNED CONTENT. It is authored, reviewed by a qualified practitioner, translated by
/// a reviewer and published through the governance registry (Phases 4 and 14) — never
/// hard-coded, and never machine-translated. Keeping the two apart is why this file
/// exists rather than one big string table: a shell label can be corrected by a developer,
/// a clinical string cannot.
@immutable
class KioskStrings {
  const KioskStrings._(this.languageTag, this._values);

  final String languageTag;
  final Map<String, String> _values;

  /// Falls back to English for any key a translation has not yet supplied. English is the
  /// reviewed baseline, so a missing key shows readable text rather than a raw key name.
  String operator [](String key) => _values[key] ?? _english[key] ?? key;

  static KioskStrings of(String languageTag) {
    return KioskStrings._(languageTag, kShellStrings[languageTag] ?? _english);
  }

  static bool supports(String languageTag) => kShellStrings.containsKey(languageTag);

  static List<String> get supportedTags => kShellStrings.keys.toList(growable: false);

  /// The English baseline. Every other table is translated from it and falls back to it.
  static Map<String, String> get _english => kShellStrings['en'] ?? const <String, String>{};

  /// What is known about each language's translation — how complete, and who checked it.
  static ShellTranslation? translationStatus(String languageTag) =>
      kShellTranslationStatus[languageTag];

  /// Shell keys whose wording is clinical vocabulary rather than navigation.
  ///
  /// Phase 6 introduced the first of these: the "what has changed?" picker names
  /// categories a patient reports against, and the master prompt specifies the labels
  /// verbatim. They are listed here rather than banned because the guard's purpose is to
  /// stop clinical wording arriving UNNOTICED, not to pretend a kiosk can avoid it.
  ///
  /// Everything in this set still needs a translation reviewer's sign-off before pilot
  /// use, and moves into the governance registry with the questionnaires in Phase 14.
  /// Writing "नई पहचान" (new identity) for "New diagnosis" instead of "नया निदान" is
  /// exactly the class of error this list exists to keep visible.
  static const Set<String> clinicalVocabularyKeys = <String>{
    'arrival.changed.symptoms',
    'arrival.changed.medicines',
    'arrival.changed.allergy',
    'arrival.changed.newReport',
    'arrival.changed.newDiagnosis',
    'documents.subtitle',
    'followup.symptoms',
    'followup.newSymptom',
    'followup.medicines',
    'followup.allergy',
    'followup.newReport',
    'followup.newDiagnosis',
    'documents.prescription',
    'documents.labReport',
    'documents.dischargeSummary',
    'documents.radiologyReport',
    'documents.referral',
  };

  /// Every key the English baseline defines. Used by a test that asserts no translation
  /// silently omits a key and no translation invents one.
  @visibleForTesting
  static Set<String> get englishKeys => _english.keys.toSet();

  @visibleForTesting
  static Map<String, Map<String, String>> get allTranslations => kShellStrings;
}
