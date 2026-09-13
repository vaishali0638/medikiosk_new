import 'package:flutter/foundation.dart';

/// Answers a patient may always give.
///
/// Rendered with the same prominence as any other option. A kiosk that buries these gets
/// a guess, and a guess recorded as a clinical answer is worse than no answer — the
/// doctor cannot tell them apart.
enum NonCommittal {
  notSure('NOT_SURE', 'question.notSure'),
  preferToDiscuss('PREFER_TO_DISCUSS_WITH_DOCTOR', 'question.preferToDiscuss'),
  notApplicable('NOT_APPLICABLE', 'question.notApplicable');

  const NonCommittal(this.wire, this.stringKey);

  final String wire;
  final String stringKey;

  static NonCommittal? fromWire(String value) {
    for (final NonCommittal v in NonCommittal.values) {
      if (v.wire == value) return v;
    }
    return null;
  }
}

@immutable
class QuestionOption {
  const QuestionOption({required this.id, required this.label});

  factory QuestionOption.fromJson(Map<String, dynamic> json) =>
      QuestionOption(id: json['id'] as String, label: json['label'] as String);

  final String id;
  final String label;
}

@immutable
class NumericScale {
  const NumericScale({
    required this.min,
    required this.max,
    required this.minLabel,
    required this.maxLabel,
  });

  factory NumericScale.fromJson(Map<String, dynamic> json) => NumericScale(
        min: json['min'] as int,
        max: json['max'] as int,
        minLabel: json['minLabel'] as String,
        maxLabel: json['maxLabel'] as String,
      );

  final int min;
  final int max;
  final String minLabel;
  final String maxLabel;
}

/// A question as the server published it.
///
/// Every field is governed content. The client renders it and composes none of it: the
/// exact wording a patient answered must be reconstructable from the questionnaire
/// version alone.
@immutable
class Question {
  const Question({
    required this.id,
    required this.type,
    required this.prompt,
    required this.nonCommittal,
    this.help,
    this.options = const <QuestionOption>[],
    this.scale,
    this.maxLength,
    this.sensitive = false,
    this.sensitiveExplanation,
  });

  factory Question.fromJson(Map<String, dynamic> json) => Question(
        id: json['id'] as String,
        type: json['type'] as String,
        prompt: json['prompt'] as String,
        help: json['help'] as String?,
        options: (json['options'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => QuestionOption.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        scale: json['scale'] == null
            ? null
            : NumericScale.fromJson(json['scale'] as Map<String, dynamic>),
        maxLength: json['maxLength'] as int?,
        sensitive: json['sensitive'] as bool? ?? false,
        sensitiveExplanation: json['sensitiveExplanation'] as String?,
        nonCommittal: (json['nonCommittal'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => NonCommittal.fromWire(e as String))
            .whereType<NonCommittal>()
            .toList(growable: false),
      );

  final String id;
  final String type;
  final String prompt;
  final String? help;
  final List<QuestionOption> options;
  final NumericScale? scale;
  final int? maxLength;
  final bool sensitive;
  final String? sensitiveExplanation;
  final List<NonCommittal> nonCommittal;

  bool get isMultiSelect => type == 'MULTI_SELECT';
  bool get isText => type == 'TEXT';
  bool get isScale => type == 'NUMERIC_SCALE';
}

/// The engine's answer to "what next?".
@immutable
class NextQuestion {
  const NextQuestion({
    required this.complete,
    required this.questionnaireVersion,
    this.question,
    this.answeredCount = 0,
    this.totalApplicable = 0,
  });

  factory NextQuestion.fromJson(Map<String, dynamic> json) => NextQuestion(
        complete: json['complete'] as bool,
        questionnaireVersion: json['questionnaireVersion'] as String,
        question: json['question'] == null
            ? null
            : Question.fromJson(json['question'] as Map<String, dynamic>),
        answeredCount: json['answeredCount'] as int? ?? 0,
        totalApplicable: json['totalApplicable'] as int? ?? 0,
      );

  final bool complete;
  final String questionnaireVersion;
  final Question? question;
  final int answeredCount;
  final int totalApplicable;
}
