import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';

void main() {
  test('every translation covers exactly the English keys', () {
    final Set<String> baseline = KioskStrings.englishKeys;

    KioskStrings.allTranslations.forEach((String tag, Map<String, String> values) {
      final Set<String> keys = values.keys.toSet();
      expect(
        keys.difference(baseline),
        isEmpty,
        reason: '$tag defines keys the English baseline does not have',
      );
      expect(
        baseline.difference(keys),
        isEmpty,
        reason: '$tag is missing keys the English baseline defines',
      );
    });
  });

  test('falls back to English for an unknown key rather than showing a raw key', () {
    expect(KioskStrings.of('hi')['home.newRegistration'], 'नया पंजीकरण');
    expect(KioskStrings.of('en')['home.newRegistration'], 'New Registration');
  });

  test('falls back to English for an unsupported language', () {
    expect(KioskStrings.of('fr')['home.newRegistration'], 'New Registration');
    expect(KioskStrings.supports('fr'), isFalse);
  });

  test('reports which languages it supports', () {
    expect(KioskStrings.supportedTags, containsAll(<String>['en', 'hi']));
  });

  test('no shell string contains a forbidden option', () {
    // The CI scan reads source; this asserts on the values a patient would actually read,
    // including the translations.
    const List<String> forbidden = <String>[
      'staff help',
      'get staff help',
      'urgent help',
      'i need urgent help',
      'generate new qr',
      'enter hospital reference',
      'register without phone',
      'enter token',
      'approved abha flow',
    ];

    KioskStrings.allTranslations.forEach((String tag, Map<String, String> values) {
      for (final MapEntry<String, String> entry in values.entries) {
        for (final String phrase in forbidden) {
          expect(
            entry.value.toLowerCase().contains(phrase),
            isFalse,
            reason: '$tag/${entry.key} contains "$phrase"',
          );
        }
      }
    });
  });

  test('no shell string states a diagnosis or clinical claim', () {
    // Shell strings are navigation and system text. Anything clinical belongs in governed
    // content, so a clinical word appearing here is a scope violation.
    const List<String> clinicalWords = <String>[
      'diagnos',
      'prescri',
      'symptom',
      'treatment',
      'medicine',
      'disease',
    ];

    KioskStrings.allTranslations.forEach((String tag, Map<String, String> values) {
      for (final MapEntry<String, String> entry in values.entries) {
        for (final String word in clinicalWords) {
          expect(
            entry.value.toLowerCase().contains(word),
            isFalse,
            reason: '$tag/${entry.key} contains clinical wording "$word"',
          );
        }
      }
    });
  });
}
