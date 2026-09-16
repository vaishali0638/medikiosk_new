import 'package:flutter_test/flutter_test.dart';
import 'package:medikiosk_kiosk/config/question.dart';
import 'package:medikiosk_kiosk/screens/spoken_option_match.dart';

/// Matching speech to options, and the cases where it must refuse.
///
/// The refusals are the point. A mis-selected answer is indistinguishable from a
/// deliberate one in the record, so an ambiguous match has to become "please tap" rather
/// than a guess the patient then confirms without noticing.
void main() {
  const List<QuestionOption> yesNo = <QuestionOption>[
    QuestionOption(id: 'yes', label: 'Yes'),
    QuestionOption(id: 'no', label: 'No'),
  ];

  const List<QuestionOption> sites = <QuestionOption>[
    QuestionOption(id: 'knee', label: 'Knee'),
    QuestionOption(id: 'left-knee', label: 'Left knee'),
    QuestionOption(id: 'back', label: 'Back'),
  ];

  test('matches the option the patient said', () {
    expect(matchSpokenOption('Yes', yesNo)?.option.id, 'yes');
    expect(matchSpokenOption('no', yesNo)?.option.id, 'no');
  });

  test('ignores punctuation and case the recogniser added', () {
    expect(matchSpokenOption('  YES. ', yesNo)?.option.id, 'yes');
  });

  test('matches an option inside a sentence', () {
    final SpokenOptionMatch? match = matchSpokenOption('I think it is my back', sites);
    expect(match?.option.id, 'back');
    expect(match?.exact, isFalse);
  });

  test('prefers the more specific label when one contains the other', () {
    // "Left knee" contains "knee". The longer label is what the patient actually said.
    expect(matchSpokenOption('it is my left knee', sites)?.option.id, 'left-knee');
  });

  test('refuses when nothing was said that matches', () {
    expect(matchSpokenOption('my shoulder hurts', sites), isNull);
    expect(matchSpokenOption('', yesNo), isNull);
  });

  test('refuses rather than guessing between two equally good matches', () {
    const List<QuestionOption> tied = <QuestionOption>[
      QuestionOption(id: 'a', label: 'Morning'),
      QuestionOption(id: 'b', label: 'Evening'),
    ];
    expect(matchSpokenOption('morning and evening', tied), isNull);
  });

  test('does not match on near-misses', () {
    // The whole reason this is exact-or-contains rather than fuzzy: an edit-distance
    // match turns "no" into "knee", and the patient confirms a transcript they recognise
    // while selecting an option they never chose.
    expect(matchSpokenOption('knee', yesNo), isNull);
    expect(matchSpokenOption('nope', yesNo), isNull);
  });

  test('works in a non-Latin script', () {
    const List<QuestionOption> tamil = <QuestionOption>[
      QuestionOption(id: 'yes', label: 'ஆம்'),
      QuestionOption(id: 'no', label: 'இல்லை'),
    ];
    expect(matchSpokenOption('ஆம்', tamil)?.option.id, 'yes');
    expect(matchSpokenOption('இல்லை.', tamil)?.option.id, 'no');
  });
}
