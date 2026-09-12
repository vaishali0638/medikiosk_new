import 'package:flutter/foundation.dart';

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
    return KioskStrings._(languageTag, _byTag[languageTag] ?? _english);
  }

  static bool supports(String languageTag) => _byTag.containsKey(languageTag);

  static List<String> get supportedTags => _byTag.keys.toList(growable: false);

  static const Map<String, String> _english = <String, String>{
    'app.title': 'MediKiosk',
    'app.tagline': 'Prepare your hospital visit',

    'home.checkInWithMobileQr': 'Check in with Mobile QR',
    'home.newRegistration': 'New Registration',
    'home.existingPatientCheckIn': 'Existing Patient Check-in',
    'home.selectLanguage': 'Select Language',
    'home.audioGuidance': 'Audio Guidance',
    'home.touchToBegin': 'Touch any option to begin',

    'language.title': 'Choose your language',
    'language.audioGuidance': 'Audio Guidance',
    'language.largeText': 'Large Text',
    'language.highContrast': 'High Contrast',
    'language.continue': 'Continue',
    'language.on': 'On',
    'language.off': 'Off',

    'common.exit': 'Exit',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'common.startAgain': 'Start again',
    'common.referenceCode': 'Reference code',

    'exit.title': 'Are you sure you want to exit?',
    'exit.body': 'Your current kiosk session will be cleared.',
    'exit.confirm': 'Exit',
    'exit.cancel': 'Continue',

    'timeout.title': 'Are you still there?',
    'timeout.body': 'This session will close soon and your answers will be cleared.',
    'timeout.continue': 'I am still here',
    'timeout.secondsRemaining': 'seconds remaining',

    'expired.title': 'This session has ended',
    'expired.body': 'Your information was cleared. Please start again when you are ready.',

    'error.title': 'Something went wrong',
    'error.body': 'This session has been cleared. Please start again.',

    'offline.title': 'The hospital system cannot be reached',
    'offline.body': 'Please try again in a moment, or speak to the counter.',
    'offline.retry': 'Try again',

    'startup.title': 'Starting up',
    'startup.body': 'Preparing this kiosk.',
    'startup.unavailable': 'This kiosk is not ready for use.',
  };

  /// Hindi shell strings. Reviewed for the shell only; clinical content is governed
  /// separately and is not translated here.
  static const Map<String, String> _hindi = <String, String>{
    'app.title': 'MediKiosk',
    'app.tagline': 'अपनी अस्पताल यात्रा तैयार करें',

    'home.checkInWithMobileQr': 'मोबाइल QR से चेक-इन करें',
    'home.newRegistration': 'नया पंजीकरण',
    'home.existingPatientCheckIn': 'पुराने रोगी का चेक-इन',
    'home.selectLanguage': 'भाषा चुनें',
    'home.audioGuidance': 'ऑडियो सहायता',
    'home.touchToBegin': 'शुरू करने के लिए कोई विकल्प चुनें',

    'language.title': 'अपनी भाषा चुनें',
    'language.audioGuidance': 'ऑडियो सहायता',
    'language.largeText': 'बड़ा अक्षर',
    'language.highContrast': 'अधिक कंट्रास्ट',
    'language.continue': 'आगे बढ़ें',
    'language.on': 'चालू',
    'language.off': 'बंद',

    'common.exit': 'बाहर निकलें',
    'common.continue': 'आगे बढ़ें',
    'common.back': 'पीछे',
    'common.startAgain': 'फिर से शुरू करें',
    'common.referenceCode': 'संदर्भ कोड',

    'exit.title': 'क्या आप बाहर निकलना चाहते हैं?',
    'exit.body': 'आपका वर्तमान सत्र मिटा दिया जाएगा।',
    'exit.confirm': 'बाहर निकलें',
    'exit.cancel': 'आगे बढ़ें',

    'timeout.title': 'क्या आप अब भी यहाँ हैं?',
    'timeout.body': 'यह सत्र जल्द बंद हो जाएगा और आपके उत्तर मिटा दिए जाएंगे।',
    'timeout.continue': 'मैं यहीं हूँ',
    'timeout.secondsRemaining': 'सेकंड शेष',

    'expired.title': 'यह सत्र समाप्त हो गया है',
    'expired.body': 'आपकी जानकारी मिटा दी गई है। तैयार होने पर फिर से शुरू करें।',

    'error.title': 'कुछ गड़बड़ हो गई',
    'error.body': 'यह सत्र मिटा दिया गया है। कृपया फिर से शुरू करें।',

    'offline.title': 'अस्पताल प्रणाली उपलब्ध नहीं है',
    'offline.body': 'कृपया थोड़ी देर बाद प्रयास करें, या काउंटर पर बात करें।',
    'offline.retry': 'फिर प्रयास करें',

    'startup.title': 'शुरू हो रहा है',
    'startup.body': 'यह कियोस्क तैयार किया जा रहा है।',
    'startup.unavailable': 'यह कियोस्क अभी उपयोग के लिए तैयार नहीं है।',
  };

  static const Map<String, Map<String, String>> _byTag = <String, Map<String, String>>{
    'en': _english,
    'hi': _hindi,
  };

  /// Every key the English baseline defines. Used by a test that asserts no translation
  /// silently omits a key and no translation invents one.
  @visibleForTesting
  static Set<String> get englishKeys => _english.keys.toSet();

  @visibleForTesting
  static Map<String, Map<String, String>> get allTranslations => _byTag;
}
