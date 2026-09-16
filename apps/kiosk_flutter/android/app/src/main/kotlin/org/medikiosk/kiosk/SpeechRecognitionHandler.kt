package org.medikiosk.kiosk

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

/**
 * On-device speech recognition for patients who cannot type.
 *
 * `EXTRA_PREFER_OFFLINE`, and on Android 12+ `createOnDeviceSpeechRecognizer`, because the
 * audio is a patient describing their symptoms. Google's default is to send it to its own
 * servers, which is a transfer of the most sensitive thing the patient says to a party the
 * hospital has no agreement with. Where on-device recognition is unavailable this reports
 * `wouldLeaveDevice` and stops — a missing feature is recoverable, an unnoticed disclosure
 * of health data is not.
 *
 * Nothing here decides anything. It returns a transcript; the caller shows it to the
 * patient, and only what they confirm is stored, with `modality: VOICE` so the clinician
 * knows a machine heard it rather than a person typed it.
 */
class SpeechRecognitionHandler(private val context: Context) : MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "org.medikiosk/speech_recognition"
    }

    private var recognizer: SpeechRecognizer? = null

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isLanguageAvailable" -> result.success(onDeviceAvailable())
            "listen" -> listen(call.argument("language"), result)
            "stop" -> {
                stopListening()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    /**
     * On-device recognition needs API 31. Below that the platform recogniser is a network
     * service whatever EXTRA_PREFER_OFFLINE says, so this reports unavailable rather than
     * quietly uploading a patient's voice.
     */
    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private fun listen(languageTag: String?, result: MethodChannel.Result) {
        if (languageTag.isNullOrBlank()) {
            result.success(mapOf("unavailable" to "notSupported"))
            return
        }
        if (!onDeviceAvailable()) {
            result.success(mapOf("unavailable" to "wouldLeaveDevice"))
            return
        }

        stopListening()

        val engine = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer = engine

        // Answered exactly once. A MethodChannel.Result replied to twice throws, and a
        // recogniser that reports results and then an error is entirely normal.
        var answered = false
        val answer = { payload: Map<String, Any?> ->
            if (!answered) {
                answered = true
                stopListening()
                result.success(payload)
            }
        }

        engine.setRecognitionListener(
            object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    val heard = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        .orEmpty()
                    val confidence = results
                        ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                        ?.firstOrNull()

                    val payload = mutableMapOf<String, Any?>("transcript" to heard)
                    if (confidence != null) payload["confidence"] = confidence.toDouble()
                    answer(payload)
                }

                override fun onError(error: Int) {
                    answer(
                        mapOf(
                            "unavailable" to
                                when (error) {
                                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                                        "permissionDenied"
                                    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
                                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
                                        "languageUnavailable"
                                    // Silence is not a failure. The patient said nothing,
                                    // which the caller handles as an empty transcript.
                                    SpeechRecognizer.ERROR_NO_MATCH,
                                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> return answer(
                                        mapOf("transcript" to ""),
                                    )
                                    else -> "notSupported"
                                },
                        ),
                    )
                }

                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            },
        )

        engine.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeFor(languageTag).toLanguageTag())
                // Belt and braces with createOnDeviceSpeechRecognizer.
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            },
        )
    }

    /**
     * Indian locales are published per region, as with the voices. Nepali is ne-NP.
     *
     * Android picks the installed model itself given a language tag, so there is no
     * candidate list here as there is on macOS — but the preferred region still matters,
     * because handing it `en` alone lets it choose any English model it happens to have.
     */
    private fun localeFor(tag: String): Locale {
        val normalised = tag.replace('_', '-')
        val parts = normalised.split('-')
        return when {
            parts.size >= 2 -> Locale(parts[0], parts[1])
            parts[0] == "ne" -> Locale("ne", "NP")
            else -> Locale(parts[0], "IN")
        }
    }

    fun stopListening() {
        recognizer?.apply {
            cancel()
            destroy()
        }
        recognizer = null
    }

    fun dispose() = stopListening()
}
