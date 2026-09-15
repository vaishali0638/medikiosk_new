package org.medikiosk.kiosk

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

/**
 * Spoken guidance, backed by the device text-to-speech engine.
 *
 * This exists because the Dart side has had an `AudioGuidance` interface since Phase 3 and
 * nothing on this side ever answered it. Every call raised `MissingPluginException`, which
 * the Dart code caught and reported as `unavailable` — so the kiosk degraded silently and
 * correctly to a state where it could not speak at all. Patients who cannot read were
 * offered an Audio Guidance button that did nothing.
 *
 * Three things this deliberately does NOT do:
 *
 *  - It does not claim a language works because the tag is known. `isLanguageAvailable`
 *    is asked for every query, and `LANG_MISSING_DATA` — the engine knows the language but
 *    the voice is not installed — is reported as unavailable, because from the patient's
 *    position those are the same thing.
 *  - It does not fall back to a different language. A Malayalam prompt read in Hindi is
 *    worse than silence: it sounds authoritative and is not understood.
 *  - It does not queue. Every utterance flushes the previous one, so a patient who moves
 *    on does not hear the last screen finishing underneath the new one.
 */
class AudioGuidanceHandler(context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "org.medikiosk/audio_guidance"
        private const val UTTERANCE_ID = "medikiosk"
    }

    /** Set once the engine reports success; every method is a no-op until then. */
    @Volatile private var ready = false

    private var engine: TextToSpeech? = null

    init {
        engine = TextToSpeech(context.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
        }.apply {
            setOnUtteranceProgressListener(
                object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) = Unit

                    @Deprecated("Required for API levels below 21")
                    override fun onError(utteranceId: String?) = Unit
                },
            )
        }
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "speak" -> result.success(speak(call.argument("text"), call.argument("language")))
            "stop" -> {
                engine?.stop()
                result.success(null)
            }
            "isLanguageSupported" ->
                result.success(isSupported(localeFor(call.argument<String>("language"))))
            "supportedLanguages" ->
                result.success(supportedAmong(call.argument<List<String>>("languages").orEmpty()))
            else -> result.notImplemented()
        }
    }

    /** Returns whether speech actually started, never whether it was merely requested. */
    private fun speak(text: String?, languageTag: String?): Boolean {
        val tts = engine ?: return false
        if (!ready || text.isNullOrBlank()) return false

        val locale = localeFor(languageTag) ?: return false
        if (!isSupported(locale)) return false
        if (tts.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) return false

        // QUEUE_FLUSH, not QUEUE_ADD: see the class comment.
        return tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID) == TextToSpeech.SUCCESS
    }

    /**
     * `LANG_MISSING_DATA` means the engine recognises the language but has no installed
     * voice for it — common on a freshly imaged kiosk, where only English ships. Treating
     * it as supported would make the kiosk offer audio that produces nothing, so it counts
     * as unsupported and `docs/runbooks/kiosk-device-setup.md` covers installing the voice.
     */
    private fun isSupported(locale: Locale?): Boolean {
        val tts = engine ?: return false
        if (!ready || locale == null) return false
        return when (tts.isLanguageAvailable(locale)) {
            TextToSpeech.LANG_AVAILABLE,
            TextToSpeech.LANG_COUNTRY_AVAILABLE,
            TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE,
            -> true
            else -> false
        }
    }

    /**
     * Which of the languages the hospital has configured this device can actually speak.
     *
     * Reported to the server at startup so `hospital_language.audio_available` stops being
     * a promise typed into a config table and becomes something measured on the device that
     * has to keep it.
     */
    private fun supportedAmong(tags: List<String>): List<String> =
        tags.filter { isSupported(localeFor(it)) }

    /**
     * Indian languages are requested with the IN region.
     *
     * Android's voices are published per region — `ta-IN`, `bn-IN`, `ur-IN` — and a bare
     * `Locale("ta")` matches inconsistently across engine versions. Tags that already carry
     * a region are honoured as given, so a hospital can register `bn-BD` if it needs to.
     *
     * Nepali is the exception the default gets wrong: its voice ships as `ne-NP`, so
     * `ne-IN` resolves to nothing and a Nepali-speaking patient in Sikkim or Darjeeling is
     * told the language cannot be spoken when in fact it can.
     */
    private fun localeFor(tag: String?): Locale? {
        if (tag.isNullOrBlank()) return null
        val normalised = tag.replace('_', '-')
        val parts = normalised.split('-')
        return when {
            parts.size >= 2 -> Locale(parts[0], parts[1])
            parts[0] == "ne" -> Locale("ne", "NP")
            else -> Locale(parts[0], "IN")
        }
    }

    /** Called when the activity goes away, so the engine does not outlive the kiosk. */
    fun dispose() {
        engine?.stop()
        engine?.shutdown()
        engine = null
        ready = false
    }
}
