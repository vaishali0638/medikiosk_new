import 'dart:ui' show TextDirection;

import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/l10n/indian_languages.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.dart';
import 'package:medikiosk_kiosk/l10n/kiosk_strings.g.dart';

void main() {
  group('language registry', () {
    test('holds all twenty-two Eighth Schedule languages, plus English', () {
      // The number IS the claim. "All Indian regional languages" is checkable precisely
      // because the Eighth Schedule is a closed list; if an edit drops one, this fails
      // rather than letting the claim go quietly false.
      expect(kIndianLanguages.where((IndianLanguage l) => l.eighthSchedule), hasLength(22));
      expect(
        kIndianLanguages.where((IndianLanguage l) => !l.eighthSchedule).map((l) => l.tag),
        <String>['en'],
      );
    });

    test('gives every language a tag, an endonym and an English name', () {
      for (final IndianLanguage l in kIndianLanguages) {
        expect(l.tag, isNotEmpty);
        expect(l.endonym, isNotEmpty, reason: '${l.englishName} has no endonym');
        expect(l.englishName, isNotEmpty);
        expect(l.script.length, 4, reason: '${l.tag} script is not an ISO 15924 code');
      }
    });

    test('uses each tag exactly once', () {
      final Set<String> tags = kIndianLanguages.map((IndianLanguage l) => l.tag).toSet();
      expect(tags.length, kIndianLanguages.length);
    });

    test('writes the endonym in the language\'s own script, not Latin', () {
      // A patient who reads only Malayalam cannot find "Malayalam" in a Latin-script list.
      // This is the whole reason the endonym is the label and the English name is not.
      for (final IndianLanguage l in kIndianLanguages) {
        if (l.script == 'Latn') continue;
        expect(
          RegExp(r'^[\x00-\x7F]+$').hasMatch(l.endonym),
          isFalse,
          reason: '${l.tag} endonym "${l.endonym}" is ASCII — it is not in ${l.script}',
        );
      }
    });

    test('marks the right-to-left languages as such', () {
      // Urdu, Kashmiri and Sindhi are written in Perso-Arabic. Getting this wrong lays the
      // whole screen out mirrored, which is worse than showing English.
      final Set<String> rtl = kIndianLanguages
          .where((IndianLanguage l) => l.direction == TextDirection.rtl)
          .map((IndianLanguage l) => l.tag)
          .toSet();
      expect(rtl, <String>{'ks', 'sd', 'ur'});

      for (final IndianLanguage l in kIndianLanguages) {
        final bool arabic = l.script == 'Arab';
        expect(l.direction == TextDirection.rtl, arabic, reason: '${l.tag} direction/script');
      }
    });

    test('flags the scripts a stock Android device cannot render', () {
      // Meetei Mayek and Ol Chiki are absent from the default font set: without a bundled
      // font, Manipuri and Santali show as rows of empty boxes.
      final Set<String> needsFont = kIndianLanguages
          .where((IndianLanguage l) => l.needsBundledFont)
          .map((IndianLanguage l) => l.tag)
          .toSet();
      expect(needsFont, <String>{'mni', 'sat'});
    });

    test('looks a language up by tag and refuses one it does not know', () {
      expect(findLanguage('ta')?.endonym, 'தமிழ்');
      expect(findLanguage('ur')?.direction, TextDirection.rtl);
      expect(findLanguage('tamil'), isNull);
      expect(isKnownLanguage('fr'), isFalse);
    });
  });

  group('shell translations', () {
    test('exist only for languages the registry knows', () {
      for (final String tag in KioskStrings.supportedTags) {
        expect(isKnownLanguage(tag), isTrue, reason: '$tag has strings but is not registered');
      }
    });

    test('are complete — a partial translation would strand a patient mid-journey', () {
      kShellTranslationStatus.forEach((String tag, ShellTranslation status) {
        expect(
          status.isComplete,
          isTrue,
          reason: '$tag has ${status.translatedKeys}/${status.totalKeys} keys',
        );
      });
    });

    test('never claim to be reviewed without naming the reviewer', () {
      // A review with nobody's name against it is a tick box, and a tick box is how
      // unchecked wording reaches a patient. Status alone is a claim; the name is evidence.
      kShellTranslationStatus.forEach((String tag, ShellTranslation status) {
        if (status.status != ShellReviewStatus.reviewed) return;
        expect(status.reviewer, isNotNull, reason: '$tag claims review with no reviewer');
        expect(status.reviewedAt, isNotNull, reason: '$tag claims review with no date');
      });
    });

    test('report honestly that none has been reviewed by a speaker yet', () {
      // This is the current, true state and it is asserted rather than described, so that
      // the day someone signs off on Tamil, this test is what makes them say so.
      final Iterable<String> reviewed = kShellTranslationStatus.entries
          .where((MapEntry<String, ShellTranslation> e) => e.value.isReviewed)
          .map((MapEntry<String, ShellTranslation> e) => e.key);
      expect(reviewed, isEmpty);
      expect(kShellTranslationStatus['en']?.status, ShellReviewStatus.baseline);
    });

    test('translate the endonym-bearing languages a patient is most likely to need', () {
      expect(
        KioskStrings.supportedTags,
        containsAll(<String>[
          'as', 'bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'ne', 'or', 'pa', 'ta', 'te', 'ur',
        ]),
      );
    });

    test('leave an untranslated language readable in English rather than blank', () {
      // Santali has no shell file yet. The kiosk must not offer a screen of empty strings.
      expect(KioskStrings.supports('sat'), isFalse);
      expect(KioskStrings.of('sat')['common.exit'], 'Exit');
    });
  });
}
