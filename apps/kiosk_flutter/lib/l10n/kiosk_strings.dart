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

    'consent.weWillCollect': 'We will collect:',
    'consent.purpose': 'Purpose',
    'consent.listen': 'Listen to explanation',
    'consent.stopListening': 'Stop',
    'consent.audioUnavailable': 'Spoken guidance is not available in this language.',
    'consent.readFullNotice': 'Read full notice',
    'consent.agree': 'Agree and Continue',
    'consent.decline': 'Do not agree',
    'consent.noticeVersion': 'Notice version',
    'consent.approvedBy': 'Approved by',
    'consent.declined.title': 'You have chosen not to provide digital consent',
    'consent.declined.body':
        'This MediKiosk clinical intake will not continue. You can still be seen at the counter in the usual way.',
    'consent.unavailable.title': 'Consent information is not available',
    'consent.unavailable.body':
        'This kiosk cannot continue in the language you chose. Please speak to the counter.',

    'identity.newRegistration.title': 'New patient registration',
    'identity.existingPatient.title': 'Existing patient check-in',
    'identity.mobileOtp': 'Mobile OTP',
    'identity.scanAbha': 'Scan ABHA QR',
    'identity.scanAppointmentQr': 'Scan appointment QR',
    'identity.enterUhid': 'Enter UHID',
    'identity.enterMobile': 'Enter mobile number',
    'identity.mobile.title': 'Enter mobile number',
    'identity.mobile.subtitle': 'We will send a code to this number.',
    'identity.sendCode': 'Send code',
    'identity.otp.title': 'Enter verification code',
    'identity.otp.sentTo': 'Code sent to',
    'identity.otp.attemptsRemaining': 'attempts remaining',
    'identity.verify': 'Verify',
    'identity.resendCode': 'Resend code',
    'identity.uhid.title': 'Enter hospital UHID',
    'identity.uhid.subtitle': 'You will find this on your hospital card or previous papers.',
    'identity.uhid.label': 'UHID',
    'identity.confirm.title': 'Is this you?',
    'identity.confirm.subtitle': 'Some details are hidden for your privacy.',
    'identity.confirm.name': 'Name',
    'identity.confirm.mobile': 'Mobile',
    'identity.confirm.uhid': 'UHID',
    'identity.confirm.yes': 'Yes, this is me',
    'identity.notConfirmed.title': 'We could not confirm your details',
    'identity.notConfirmed.body':
        'Please speak to the counter, where staff can help you check in.',

    'arrival.scan.title': 'Check in with Mobile QR',
    'arrival.scan.subtitle': 'Show your MediKiosk QR code on your mobile phone.',
    'arrival.scan.action': 'Scan QR',
    'arrival.scan.cameraUnavailable':
        'The scanner is not working on this kiosk. Please speak to the counter.',
    'arrival.confirm.title': 'Confirm your visit',
    'arrival.confirm.subtitle': 'Some details are hidden for your privacy.',
    'arrival.confirm.name': 'Name',
    'arrival.confirm.mobile': 'Mobile',
    'arrival.confirm.hospital': 'Hospital',
    'arrival.confirm.department': 'Department',
    'arrival.confirm.visitType': 'Visit type',
    'arrival.confirm.yes': 'Yes, continue',
    'arrival.changed.title': 'Has anything changed since you filled this in?',
    'arrival.changed.nothing': 'No, nothing has changed',
    'arrival.changed.somethingChanged': 'Yes, something has changed',
    'arrival.changed.whatChanged': 'What has changed?',
    'arrival.changed.symptoms': 'Symptoms',
    'arrival.changed.medicines': 'Medicines',
    'arrival.changed.allergy': 'Allergy or side effect',
    'arrival.changed.newReport': 'New report',
    'arrival.changed.newDiagnosis': 'New diagnosis',
    'arrival.changed.other': 'Something else',
    'arrival.rejected.title': 'This QR cannot be used',
    'arrival.rejected.body':
        'Please speak to the counter, where staff can help you check in.',

    'token.title': 'Check-in successful',
    'token.yourToken': 'Your hospital token',
    'token.department': 'Department',
    'token.room': 'Room',
    'token.queueStatus': 'Queue status',
    'token.print': 'Print token',
    'token.printFailed': 'The printer is not working. Your token above is still valid — please note it down or photograph it.',
    'token.sendToMobile': 'Send to mobile',
    'token.sentToMobile': 'Sent to your mobile',
    'token.finish': 'Finish',
    'token.pending.title': 'Please speak to the counter',
    'token.pending.body': 'We could not confirm your token with the hospital system. Staff at the counter can complete your check-in.',

    'question.notSure': 'I am not sure',
    'question.preferToDiscuss': 'I prefer to tell the doctor',
    'question.notApplicable': 'This does not apply to me',
    'question.whyAsking': 'Why are we asking?',
    'question.answer': 'Answer this question',
    'question.progress': 'Question',

    'ayush.title': 'Select AYUSH system',
    'ayush.subtitle': 'If you are not sure, the doctor will decide with you.',
    'ayush.ayurveda': 'Ayurveda',
    'ayush.unani': 'Unani',
    'ayush.siddha': 'Siddha',
    'ayush.yogaNaturopathy': 'Yoga & Naturopathy',
    'ayush.sowaRigpa': 'Sowa-Rigpa',
    'ayush.homoeopathy': 'Homoeopathy',
    'ayush.notSure': 'I am not sure',

    'documents.title': 'Add previous records',
    'documents.subtitle':
        'Prescriptions, lab reports or discharge papers from earlier visits, if you have them with you.',
    'documents.takePhoto': 'Take a photo',
    'documents.useScanner': 'Use scanner',
    'documents.uploadFile': 'Upload file',
    'documents.noDocuments': 'I have no documents',
    'documents.captureUnavailable':
        'Documents cannot be added at this kiosk. You can show them to the doctor.',
    'documents.attached': 'Documents added',
    'documents.whatIsThis': 'What is this document?',
    'documents.prescription': 'Prescription',
    'documents.labReport': 'Lab report',
    'documents.dischargeSummary': 'Discharge summary',
    'documents.radiologyReport': 'Radiology report',
    'documents.referral': 'Referral',
    'documents.other': 'Other',
    'documents.qualityTitle': 'The image may be difficult to read.',
    'documents.qualityBody': 'Possible problems:',
    'documents.quality.blurry': 'Blurry image',
    'documents.quality.missingEdge': 'Missing edge',
    'documents.quality.glare': 'Glare or reflection',
    'documents.quality.tooDark': 'Text too dark',
    'documents.useThisImage': 'Use this image',
    'documents.uploadedCount': 'Documents uploaded',
    'documents.uploaded': 'uploaded',
    'documents.saved': 'saved',
    'documents.ocrProcessing': 'reading in progress',
    'documents.readyForDoctor': 'saved, for the doctor to check',
    'documents.savedNotRead': 'saved — the doctor will read it',
    'documents.notAccepted': 'not accepted',
    'documents.originalsSaved': 'The original documents are saved.',
    'documents.doctorMustVerify': 'Extracted information must be verified by the doctor.',

    'review.title': 'Review before submission',
    'review.subtitle': 'Please check your answers.',
    'review.sentTo': 'This information will be sent to authorised hospital staff.',
    'review.submit': 'I reviewed and want to submit',
    'review.edit': 'Edit',
    'review.label': 'Label',
    'review.noAnswer': 'Not answered',
    'review.documents': 'Documents you added',
    'review.submitted.title': 'Your information has been sent',
    'review.submitted.body':
        'The doctor will see it before your consultation. You can collect your token next.',

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

    'consent.weWillCollect': 'हम यह जानकारी लेंगे:',
    'consent.purpose': 'उद्देश्य',
    'consent.listen': 'सुनकर समझें',
    'consent.stopListening': 'रोकें',
    'consent.audioUnavailable': 'इस भाषा में बोलकर सहायता उपलब्ध नहीं है।',
    'consent.readFullNotice': 'पूरी सूचना पढ़ें',
    'consent.agree': 'सहमत हूँ और आगे बढ़ें',
    'consent.decline': 'सहमत नहीं हूँ',
    'consent.noticeVersion': 'सूचना संस्करण',
    'consent.approvedBy': 'स्वीकृत किया',
    'consent.declined.title': 'आपने डिजिटल सहमति नहीं दी है',
    'consent.declined.body':
        'यह MediKiosk प्रक्रिया आगे नहीं बढ़ेगी। आप हमेशा की तरह काउंटर पर दिखा सकते हैं।',
    'consent.unavailable.title': 'सहमति की जानकारी उपलब्ध नहीं है',
    'consent.unavailable.body':
        'आपकी चुनी हुई भाषा में यह कियोस्क आगे नहीं बढ़ सकता। कृपया काउंटर पर बात करें।',

    'identity.newRegistration.title': 'नए रोगी का पंजीकरण',
    'identity.existingPatient.title': 'पुराने रोगी का चेक-इन',
    'identity.mobileOtp': 'मोबाइल OTP',
    'identity.scanAbha': 'ABHA QR स्कैन करें',
    'identity.scanAppointmentQr': 'अपॉइंटमेंट QR स्कैन करें',
    'identity.enterUhid': 'UHID दर्ज करें',
    'identity.enterMobile': 'मोबाइल नंबर दर्ज करें',
    'identity.mobile.title': 'मोबाइल नंबर दर्ज करें',
    'identity.mobile.subtitle': 'हम इस नंबर पर एक कोड भेजेंगे।',
    'identity.sendCode': 'कोड भेजें',
    'identity.otp.title': 'सत्यापन कोड दर्ज करें',
    'identity.otp.sentTo': 'कोड भेजा गया',
    'identity.otp.attemptsRemaining': 'प्रयास शेष',
    'identity.verify': 'सत्यापित करें',
    'identity.resendCode': 'कोड फिर भेजें',
    'identity.uhid.title': 'अस्पताल UHID दर्ज करें',
    'identity.uhid.subtitle': 'यह आपके अस्पताल कार्ड या पुराने कागज़ों पर मिलेगा।',
    'identity.uhid.label': 'UHID',
    'identity.confirm.title': 'क्या यह आप हैं?',
    'identity.confirm.subtitle': 'आपकी निजता के लिए कुछ विवरण छिपाए गए हैं।',
    'identity.confirm.name': 'नाम',
    'identity.confirm.mobile': 'मोबाइल',
    'identity.confirm.uhid': 'UHID',
    'identity.confirm.yes': 'हाँ, यह मैं हूँ',
    'identity.notConfirmed.title': 'हम आपका विवरण सत्यापित नहीं कर सके',
    'identity.notConfirmed.body': 'कृपया काउंटर पर बात करें, वहाँ कर्मचारी आपकी मदद करेंगे।',

    'arrival.scan.title': 'मोबाइल QR से चेक-इन करें',
    'arrival.scan.subtitle': 'अपने मोबाइल पर MediKiosk QR कोड दिखाएँ।',
    'arrival.scan.action': 'QR स्कैन करें',
    'arrival.scan.cameraUnavailable':
        'इस कियोस्क पर स्कैनर काम नहीं कर रहा। कृपया काउंटर पर बात करें।',
    'arrival.confirm.title': 'अपनी विज़िट की पुष्टि करें',
    'arrival.confirm.subtitle': 'आपकी निजता के लिए कुछ विवरण छिपाए गए हैं।',
    'arrival.confirm.name': 'नाम',
    'arrival.confirm.mobile': 'मोबाइल',
    'arrival.confirm.hospital': 'अस्पताल',
    'arrival.confirm.department': 'विभाग',
    'arrival.confirm.visitType': 'विज़िट का प्रकार',
    'arrival.confirm.yes': 'हाँ, आगे बढ़ें',
    'arrival.changed.title': 'क्या इसे भरने के बाद कुछ बदला है?',
    'arrival.changed.nothing': 'नहीं, कुछ नहीं बदला',
    'arrival.changed.somethingChanged': 'हाँ, कुछ बदला है',
    'arrival.changed.whatChanged': 'क्या बदला है?',
    'arrival.changed.symptoms': 'लक्षण',
    'arrival.changed.medicines': 'दवाइयाँ',
    'arrival.changed.allergy': 'एलर्जी या दुष्प्रभाव',
    'arrival.changed.newReport': 'नई रिपोर्ट',
    'arrival.changed.newDiagnosis': 'नया निदान',
    'arrival.changed.other': 'कुछ और',
    'arrival.rejected.title': 'यह QR उपयोग नहीं किया जा सकता',
    'arrival.rejected.body': 'कृपया काउंटर पर बात करें, वहाँ कर्मचारी आपकी मदद करेंगे।',

    'token.title': 'चेक-इन सफल',
    'token.yourToken': 'आपका अस्पताल टोकन',
    'token.department': 'विभाग',
    'token.room': 'कमरा',
    'token.queueStatus': 'कतार की स्थिति',
    'token.print': 'टोकन प्रिंट करें',
    'token.printFailed': 'प्रिंटर काम नहीं कर रहा। ऊपर दिया टोकन फिर भी मान्य है — कृपया इसे लिख लें या फ़ोटो ले लें।',
    'token.sendToMobile': 'मोबाइल पर भेजें',
    'token.sentToMobile': 'आपके मोबाइल पर भेजा गया',
    'token.finish': 'समाप्त करें',
    'token.pending.title': 'कृपया काउंटर पर बात करें',
    'token.pending.body': 'हम अस्पताल प्रणाली से आपका टोकन पक्का नहीं कर सके। काउंटर पर कर्मचारी आपका चेक-इन पूरा कर देंगे।',

    'question.notSure': 'मुझे पक्का नहीं पता',
    'question.preferToDiscuss': 'मैं डॉक्टर को बताना चाहूँगा/चाहूँगी',
    'question.notApplicable': 'यह मुझ पर लागू नहीं होता',
    'question.whyAsking': 'हम यह क्यों पूछ रहे हैं?',
    'question.answer': 'इस प्रश्न का उत्तर दें',
    'question.progress': 'प्रश्न',

    'ayush.title': 'आयुष प्रणाली चुनें',
    'ayush.subtitle': 'यदि आप निश्चित नहीं हैं, तो डॉक्टर आपके साथ तय करेंगे।',
    'ayush.ayurveda': 'आयुर्वेद',
    'ayush.unani': 'यूनानी',
    'ayush.siddha': 'सिद्ध',
    'ayush.yogaNaturopathy': 'योग एवं प्राकृतिक चिकित्सा',
    'ayush.sowaRigpa': 'सोवा-रिग्पा',
    'ayush.homoeopathy': 'होम्योपैथी',
    'ayush.notSure': 'मुझे पक्का नहीं पता',

    'documents.title': 'पुराने कागज़ात जोड़ें',
    'documents.subtitle':
        'पिछली विज़िट के पर्चे, जाँच रिपोर्ट या छुट्टी के कागज़, यदि वे आपके पास हैं।',
    'documents.takePhoto': 'फ़ोटो लें',
    'documents.useScanner': 'स्कैनर का उपयोग करें',
    'documents.uploadFile': 'फ़ाइल अपलोड करें',
    'documents.noDocuments': 'मेरे पास कोई कागज़ात नहीं हैं',
    'documents.captureUnavailable':
        'इस कियोस्क पर कागज़ात नहीं जोड़े जा सकते। आप उन्हें डॉक्टर को दिखा सकते हैं।',
    'documents.attached': 'जोड़े गए कागज़ात',
    'documents.whatIsThis': 'यह कौन सा कागज़ है?',
    'documents.prescription': 'पर्चा',
    'documents.labReport': 'जाँच रिपोर्ट',
    'documents.dischargeSummary': 'छुट्टी का सारांश',
    'documents.radiologyReport': 'रेडियोलॉजी रिपोर्ट',
    'documents.referral': 'रेफ़रल',
    'documents.other': 'अन्य',
    'documents.qualityTitle': 'यह तस्वीर पढ़ने में कठिन हो सकती है।',
    'documents.qualityBody': 'संभावित कारण:',
    'documents.quality.blurry': 'तस्वीर धुंधली है',
    'documents.quality.missingEdge': 'किनारा कट गया है',
    'documents.quality.glare': 'चमक या परछाईं',
    'documents.quality.tooDark': 'अक्षर बहुत गहरे हैं',
    'documents.useThisImage': 'यही तस्वीर उपयोग करें',
    'documents.uploadedCount': 'अपलोड किए गए कागज़ात',
    'documents.uploaded': 'अपलोड हो गया',
    'documents.saved': 'सुरक्षित',
    'documents.ocrProcessing': 'पढ़ा जा रहा है',
    'documents.readyForDoctor': 'सुरक्षित, डॉक्टर द्वारा जाँचा जाएगा',
    'documents.savedNotRead': 'सुरक्षित — डॉक्टर इसे पढ़ेंगे',
    'documents.notAccepted': 'स्वीकार नहीं हुआ',
    'documents.originalsSaved': 'मूल कागज़ात सुरक्षित रख लिए गए हैं।',
    'documents.doctorMustVerify': 'निकाली गई जानकारी की जाँच डॉक्टर द्वारा की जाएगी।',

    'review.title': 'भेजने से पहले जाँच लें',
    'review.subtitle': 'कृपया अपने उत्तर देख लें।',
    'review.sentTo': 'यह जानकारी अधिकृत अस्पताल कर्मचारियों को भेजी जाएगी।',
    'review.submit': 'मैंने जाँच लिया, अब भेजें',
    'review.edit': 'बदलें',
    'review.label': 'लेबल',
    'review.noAnswer': 'उत्तर नहीं दिया',
    'review.documents': 'आपके जोड़े गए कागज़ात',
    'review.submitted.title': 'आपकी जानकारी भेज दी गई है',
    'review.submitted.body':
        'डॉक्टर परामर्श से पहले इसे देख लेंगे। अब आप अपना टोकन ले सकते हैं।',

    'startup.title': 'शुरू हो रहा है',
    'startup.body': 'यह कियोस्क तैयार किया जा रहा है।',
    'startup.unavailable': 'यह कियोस्क अभी उपयोग के लिए तैयार नहीं है।',
  };

  static const Map<String, Map<String, String>> _byTag = <String, Map<String, String>>{
    'en': _english,
    'hi': _hindi,
  };

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
  static Map<String, Map<String, String>> get allTranslations => _byTag;
}
