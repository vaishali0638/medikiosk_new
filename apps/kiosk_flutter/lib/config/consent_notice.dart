import 'package:flutter/foundation.dart';

/// A published consent notice, from `GET /v1/consents/notice`.
///
/// Every field is governed content served by the API. Nothing here is composed in the
/// client, because the exact wording a patient agreed to must be reconstructable from
/// [version] alone, years later.
@immutable
class ConsentNotice {
  const ConsentNotice({
    required this.version,
    required this.language,
    required this.title,
    required this.collectedItems,
    required this.purpose,
    required this.fullText,
    required this.audioAvailable,
    required this.approvedBy,
  });

  factory ConsentNotice.fromJson(Map<String, dynamic> json) => ConsentNotice(
        version: json['version'] as String,
        language: json['language'] as String,
        title: json['title'] as String,
        collectedItems: (json['collectedItems'] as List<dynamic>)
            .map((dynamic e) => e as String)
            .toList(growable: false),
        purpose: json['purpose'] as String,
        fullText: json['fullText'] as String,
        audioAvailable: json['audioAvailable'] as bool? ?? false,
        approvedBy: (json['approvedBy'] as List<dynamic>? ?? <dynamic>[])
            .map((dynamic e) => e as String)
            .toList(growable: false),
      );

  final String version;
  final String language;
  final String title;
  final List<String> collectedItems;
  final String purpose;
  final String fullText;

  /// Whether an approved recording exists. When false the kiosk may still read the text
  /// with device TTS, but must say that is what it is doing.
  final bool audioAvailable;

  final List<String> approvedBy;
}
