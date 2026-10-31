package com.deskos.panel

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Native Speech Recognition and TextToSpeech engine for DESK AI on Samsung Galaxy M01s.
 * Enforces strictly phone-side audio capture & TTS. Zero laptop microphone involvement.
 * Evaluates real-device support for Gujarati (gu-IN) and English (en-IN / en-US).
 */
class VoiceAssistantHelper(
    private val activity: Activity,
    private val eventListener: (eventName: String, jsonPayload: String) -> Unit
) {

    private val context: Context = activity.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private var activeLanguageMode = "AUTO"

    private var tts: TextToSpeech? = null
    private var isTtsReady = false
    private var lastRmsDispatchTime = 0L

    init {
        mainHandler.post {
            initSpeechRecognizer()
            initTts()
        }
    }

    // -------------------------------------------------------------------------
    // SPEECH RECOGNITION (STT)
    // -------------------------------------------------------------------------
    private fun initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            dispatchAiEvent("stt_status", JSONObject().apply {
                put("available", false)
                put("error", "SpeechRecognizer service not available on this device.")
            })
            return
        }

        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(createRecognitionListener())
            }
        } catch (e: Exception) {
            dispatchAiEvent("stt_status", JSONObject().apply {
                put("available", false)
                put("error", e.message ?: "Failed to initialize SpeechRecognizer")
            })
        }
    }

    fun hasMicrophonePermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun requestMicrophonePermission() {
        activity.runOnUiThread {
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2004)
        }
    }

    fun startListening(languageMode: String = "AUTO"): Boolean {
        if (!hasMicrophonePermission()) {
            requestMicrophonePermission()
            return false
        }

        activeLanguageMode = languageMode.uppercase()

        mainHandler.post {
            try {
                if (speechRecognizer == null) {
                    initSpeechRecognizer()
                }

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)

                    when (activeLanguageMode) {
                        "GUJARATI" -> {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "gu-IN")
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "gu-IN")
                        }
                        "ENGLISH" -> {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN")
                        }
                        else -> { // AUTO (Multilingual Gujarati + Indian English)
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN")
                            putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", arrayOf("gu-IN", "en-US", "en-IN"))
                        }
                    }
                }

                speechRecognizer?.startListening(intent)
                isListening = true
                dispatchAiEvent("listening_started", JSONObject().apply {
                    put("languageMode", activeLanguageMode)
                })
            } catch (e: Exception) {
                isListening = false
                dispatchAiEvent("speech_error", JSONObject().apply {
                    put("error", e.message ?: "Failed to start listening")
                    put("code", -1)
                })
            }
        }
        return true
    }

    fun stopListening() {
        mainHandler.post {
            try {
                if (isListening) {
                    speechRecognizer?.stopListening()
                    isListening = false
                    dispatchAiEvent("listening_ended", JSONObject())
                }
            } catch (_: Exception) {}
        }
    }

    private fun createRecognitionListener(): RecognitionListener {
        return object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                dispatchAiEvent("listening_ready", JSONObject().put("status", "ready"))
            }

            override fun onBeginningOfSpeech() {
                dispatchAiEvent("listening_active", JSONObject().put("status", "speech_detected"))
            }

            override fun onRmsChanged(rmsdB: Float) {
                val now = System.currentTimeMillis()
                // Throttle RMS updates to 40ms (~25 FPS) to keep WebView buttery smooth on 3GB RAM
                if (now - lastRmsDispatchTime >= 40) {
                    lastRmsDispatchTime = now
                    // Normalize standard SpeechRecognizer -2dB to +10dB range to 0.0 - 1.0
                    val normalizedRms = ((rmsdB + 2.0f) / 12.0f).coerceIn(0.0f, 1.0f)
                    dispatchAiEvent("rms_changed", JSONObject().put("rms", normalizedRms))
                }
            }

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                isListening = false
                dispatchAiEvent("listening_ended", JSONObject().put("status", "processing"))
            }

            override fun onError(error: Int) {
                isListening = false
                val (msgEn, msgGu) = mapSpeechError(error)
                dispatchAiEvent("speech_error", JSONObject().apply {
                    put("code", error)
                    put("error", msgEn)
                    put("error_gu", msgGu)
                })
            }

            override fun onResults(results: Bundle?) {
                isListening = false
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val primaryText = matches?.firstOrNull() ?: ""
                val alts = JSONArray(matches ?: emptyList<String>())

                dispatchAiEvent("final_transcript", JSONObject().apply {
                    put("text", primaryText)
                    put("alternatives", alts)
                    put("languageMode", activeLanguageMode)
                })
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val partialText = matches?.firstOrNull() ?: ""
                if (partialText.isNotBlank()) {
                    dispatchAiEvent("partial_transcript", JSONObject().apply {
                        put("text", partialText)
                    })
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        }
    }

    private fun mapSpeechError(errorCode: Int): Pair<String, String> {
        return when (errorCode) {
            SpeechRecognizer.ERROR_NO_MATCH ->
                "No speech recognized. Please speak again." to "કોઈ અવાજ ઓળખાયો નથી. કૃપા કરીને ફરી બોલો."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                "Listening timed out (no speech detected)." to "સમય સમાપ્ત થયો, કોઈ અવાજ મળ્યો નથી."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                "Microphone permission is required." to "માઇક્રોફોન પરવાનગી જરૂરી છે."
            SpeechRecognizer.ERROR_NETWORK ->
                "Network connection error." to "ઇન્ટરનેટ કનેક્શન સમસ્યા."
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                "Network timeout during speech recognition." to "અવાજ ઓળખવામાં નેટવર્ક વિલંબ."
            SpeechRecognizer.ERROR_AUDIO ->
                "Audio recording hardware error." to "ઓડિયો રેકોર્ડિંગમાં સમસ્યા."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                "Speech recognition service busy. Try again." to "સર્વિસ વ્યસ્ત છે. ફરી પ્રયત્ન કરો."
            else ->
                "Voice recognition error ($errorCode)" to "અવાજ ઓળખવામાં ભૂલ આવી ($errorCode)"
        }
    }

    // -------------------------------------------------------------------------
    // TEXT TO SPEECH (TTS)
    // -------------------------------------------------------------------------
    private fun initTts() {
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                isTtsReady = true
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        val payload = JSONObject().put("id", utteranceId ?: "")
                        dispatchAiEvent("speaking_started", payload)
                        dispatchAiEvent("tts_start", payload)
                    }

                    override fun onDone(utteranceId: String?) {
                        val payload = JSONObject().put("id", utteranceId ?: "")
                        dispatchAiEvent("speaking_ended", payload)
                        dispatchAiEvent("tts_done", payload)
                    }

                    override fun onError(utteranceId: String?) {
                        val payload = JSONObject().put("id", utteranceId ?: "")
                        dispatchAiEvent("speaking_ended", payload)
                        dispatchAiEvent("tts_done", payload)
                    }
                })
            } else {
                isTtsReady = false
            }
        }
    }

    fun hasGujaratiTts(): Boolean {
        val t = tts ?: return false
        if (!isTtsReady) return false
        val res = t.isLanguageAvailable(Locale("gu", "IN"))
        return res >= TextToSpeech.LANG_AVAILABLE
    }

    fun hasEnglishTts(): Boolean {
        val t = tts ?: return false
        if (!isTtsReady) return false
        val res = t.isLanguageAvailable(Locale("en", "IN"))
        val usRes = t.isLanguageAvailable(Locale.US)
        return res >= TextToSpeech.LANG_AVAILABLE || usRes >= TextToSpeech.LANG_AVAILABLE
    }

    fun speak(text: String, language: String = "AUTO", rate: Float = 1.0f): Boolean {
        val t = tts ?: return false
        if (!isTtsReady || text.isBlank()) return false

        val isGu = language.startsWith("gu", ignoreCase = true) || language.equals("GUJARATI", ignoreCase = true)
        val guSupported = hasGujaratiTts()

        val targetLocale = if (isGu && guSupported) {
            Locale("gu", "IN")
        } else {
            Locale("en", "IN")
        }

        try {
            t.language = targetLocale
            t.setSpeechRate(rate.coerceIn(0.6f, 1.8f))
            val utteranceId = "DESK_AI_" + System.currentTimeMillis()
            val result = t.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            return result == TextToSpeech.SUCCESS
        } catch (e: Exception) {
            dispatchAiEvent("speech_error", JSONObject().apply {
                put("error", "TTS speech failed: ${e.message}")
            })
            return false
        }
    }

    fun stopSpeaking() {
        tts?.stop()
        dispatchAiEvent("speaking_ended", JSONObject().put("status", "stopped"))
    }

    fun getVoiceCapabilitiesJson(): String {
        val hasStt = SpeechRecognizer.isRecognitionAvailable(context)
        val hasGuTts = hasGujaratiTts()
        val hasEnTts = hasEnglishTts()

        return JSONObject().apply {
            put("speechRecognitionAvailable", hasStt)
            put("hasGujaratiTts", hasGuTts)
            put("hasEnglishTts", hasEnTts)
            put("engineName", tts?.defaultEngine ?: "com.google.android.tts")
            put("isListening", isListening)
            put("isTtsReady", isTtsReady)
        }.toString()
    }

    fun destroy() {
        try {
            speechRecognizer?.destroy()
            speechRecognizer = null
        } catch (_: Exception) {}

        try {
            tts?.stop()
            tts?.shutdown()
            tts = null
        } catch (_: Exception) {}
    }

    private fun dispatchAiEvent(eventName: String, jsonPayload: JSONObject) {
        val fullMsg = JSONObject().apply {
            put("type", eventName)
            put("data", jsonPayload)
        }
        eventListener(eventName, fullMsg.toString())
    }
}
