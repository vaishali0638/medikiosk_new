import 'package:flutter/foundation.dart';

/// A language the hospital offers. Only clinically reviewed languages are ever sent by
/// the server, so the kiosk does not need to filter again — but the flag is carried so
/// the invariant is visible at the point of use.
@immutable
class LanguageOption {
  const LanguageOption({
    required this.tag,
    required this.label,
    required this.clinicallyReviewed,
    required this.audioAvailable,
  });

  factory LanguageOption.fromJson(Map<String, dynamic> json) => LanguageOption(
        tag: json['tag'] as String,
        label: json['label'] as String,
        clinicallyReviewed: json['clinicallyReviewed'] as bool? ?? false,
        audioAvailable: json['audioAvailable'] as bool? ?? false,
      );

  final String tag;

  /// Endonym, shown in the language's own script.
  final String label;
  final bool clinicallyReviewed;
  final bool audioAvailable;
}

/// Feature availability. A disabled feature must not render at all.
@immutable
class FeatureFlags {
  const FeatureFlags({
    required this.abha,
    required this.aiSummary,
    required this.ocr,
    required this.redFlags,
    required this.voiceIntake,
  });

  factory FeatureFlags.fromJson(Map<String, dynamic> json) => FeatureFlags(
        abha: json['abha'] as bool? ?? false,
        aiSummary: json['aiSummary'] as bool? ?? false,
        ocr: json['ocr'] as bool? ?? false,
        redFlags: json['redFlags'] as bool? ?? false,
        voiceIntake: json['voiceIntake'] as bool? ?? false,
      );

  /// Everything off. Used before configuration loads, so a kiosk that has not yet reached
  /// the server never renders a feature it has not been told it may offer.
  static const FeatureFlags allDisabled = FeatureFlags(
    abha: false,
    aiSummary: false,
    ocr: false,
    redFlags: false,
    voiceIntake: false,
  );

  final bool abha;
  final bool aiSummary;
  final bool ocr;
  final bool redFlags;
  final bool voiceIntake;
}

@immutable
class SessionTiming {
  const SessionTiming({required this.warning, required this.wipe});

  factory SessionTiming.fromJson(Map<String, dynamic> json) => SessionTiming(
        warning: Duration(seconds: json['inactivityWarningSeconds'] as int),
        wipe: Duration(seconds: json['inactivityWipeSeconds'] as int),
      );

  /// Idle time before the patient is warned.
  final Duration warning;

  /// Further idle time after the warning before the session is wiped.
  final Duration wipe;

  Duration get total => warning + wipe;
}

/// Configuration the kiosk boots against, from `GET /v1/kiosk/config`.
@immutable
class KioskConfig {
  const KioskConfig({
    required this.hospitalId,
    required this.hospitalName,
    required this.branchId,
    required this.kioskId,
    required this.languages,
    required this.features,
    required this.session,
    required this.consentNoticeVersion,
  });

  factory KioskConfig.fromJson(Map<String, dynamic> json) => KioskConfig(
        hospitalId: json['hospitalId'] as String,
        hospitalName: json['hospitalName'] as String,
        branchId: json['branchId'] as String,
        kioskId: json['kioskId'] as String,
        languages: (json['languages'] as List<dynamic>)
            .map((dynamic e) => LanguageOption.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        features: FeatureFlags.fromJson(json['features'] as Map<String, dynamic>),
        session: SessionTiming.fromJson(json['session'] as Map<String, dynamic>),
        consentNoticeVersion:
            (json['contentVersions'] as Map<String, dynamic>)['consentNotice'] as String,
      );

  final String hospitalId;
  final String hospitalName;
  final String branchId;
  final String kioskId;
  final List<LanguageOption> languages;
  final FeatureFlags features;
  final SessionTiming session;
  final String consentNoticeVersion;

  /// The consent notice must be a published governed version before a patient can be
  /// asked to agree to anything. `UNPUBLISHED` means the hospital has not approved one.
  bool get hasApprovedConsentNotice => consentNoticeVersion != 'UNPUBLISHED';
}
