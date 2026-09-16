import '../config/question.dart';

/// What a spoken answer was matched to, and how confidently.
class SpokenOptionMatch {
  const SpokenOptionMatch({required this.option, required this.exact});

  final QuestionOption option;

  /// Whether the patient said the option's words, rather than something containing them.
  final bool exact;
}

/// Matches what the patient said against the options on screen.
///
/// Deliberately conservative, and deliberately not fuzzy. Edit distance would turn "no
/// pain" into "knee pain" and a patient confirming a transcript they recognise would be
/// selecting an option they did not choose. Everything here is exact or containment on
/// normalised text, so a match is something the patient demonstrably said.
///
/// An ambiguous result is no result. Two options both matching means the kiosk cannot
/// tell which was meant, and guessing between them is worse than asking the patient to
/// tap — a mis-selected answer looks identical to a deliberate one in the record.
///
/// Whatever this returns, the patient still confirms it before it is selected. This
/// narrows the choice; it never makes it.
SpokenOptionMatch? matchSpokenOption(String transcript, List<QuestionOption> options) {
  final String heard = _normalise(transcript);
  if (heard.isEmpty) return null;

  final List<SpokenOptionMatch> exact = <SpokenOptionMatch>[];
  final List<SpokenOptionMatch> contained = <SpokenOptionMatch>[];

  for (final QuestionOption option in options) {
    final String label = _normalise(option.label);
    if (label.isEmpty) continue;

    if (heard == label) {
      exact.add(SpokenOptionMatch(option: option, exact: true));
    } else if (_containsWords(heard, label)) {
      // "I think it is the left knee" contains "left knee". The patient said the words.
      contained.add(SpokenOptionMatch(option: option, exact: false));
    }
  }

  if (exact.length == 1) return exact.first;
  if (exact.length > 1) return null;

  if (contained.length == 1) return contained.first;

  // Two options whose labels both appear — "knee" and "left knee", say. The longer label
  // is the more specific thing the patient said, and only counts if nothing else ties.
  if (contained.length > 1) {
    contained.sort(
      (SpokenOptionMatch a, SpokenOptionMatch b) =>
          b.option.label.length.compareTo(a.option.label.length),
    );
    final int longest = contained.first.option.label.length;
    final bool tied = contained.where((m) => m.option.label.length == longest).length > 1;
    return tied ? null : contained.first;
  }

  return null;
}

/// Whether [haystack] contains [needle] as WHOLE WORDS.
///
/// Substring containment was the first implementation and it was wrong in the way that
/// matters: "nope" contains "no", so a patient saying "nope" was offered "No" — the
/// opposite answer, in a form they would plausibly confirm without reading closely.
/// "nothing", "north" and "know" do the same to a two-letter label.
bool _containsWords(String haystack, String needle) {
  final List<String> words = haystack.split(' ');
  final List<String> target = needle.split(' ');
  if (target.isEmpty || target.length > words.length) return false;

  for (int start = 0; start + target.length <= words.length; start += 1) {
    var matched = true;
    for (int offset = 0; offset < target.length; offset += 1) {
      if (words[start + offset] != target[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/// Lowercase, punctuation stripped, whitespace collapsed.
///
/// Recognisers punctuate and capitalise differently across languages and versions, and
/// none of that is the patient's meaning.
String _normalise(String value) => value
    .toLowerCase()
    .replaceAll(RegExp(r'[^\p{L}\p{N}\s]', unicode: true), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();
