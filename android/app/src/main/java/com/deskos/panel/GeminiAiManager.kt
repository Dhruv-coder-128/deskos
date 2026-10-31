package com.deskos.panel

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Modular Google Gemini API integration running directly from phone to Google AI Studio.
 * Uses free-tier models (default: gemini-1.5-flash) on ₹0 budget.
 * API key is stored strictly inside Android Keystore via SecurityHelper and NEVER leaked to WebView/JS.
 */
class GeminiAiManager(
    private val context: Context,
    private val securityHelper: SecurityHelper
) {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    companion object {
        private const val KEY_GEMINI_API_KEY = "gemini_api_key"
        private const val KEY_GEMINI_MODEL = "gemini_model"
        const val DEFAULT_MODEL = "gemini-flash-lite-latest"
        private const val API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
    }

    fun hasApiKey(): Boolean {
        val key = securityHelper.getSecret(KEY_GEMINI_API_KEY)
        return !key.isNullOrBlank()
    }

    fun saveApiKey(apiKey: String): Boolean {
        val clean = apiKey.trim()
        if (clean.isBlank()) return false
        securityHelper.saveSecret(KEY_GEMINI_API_KEY, clean)
        return true
    }

    fun removeApiKey(): Boolean {
        securityHelper.removeSecret(KEY_GEMINI_API_KEY)
        return true
    }

    fun getModel(): String {
        val stored = securityHelper.getSecret(KEY_GEMINI_MODEL)
        if (stored.isNullOrBlank() || stored == "gemini-1.5-flash" || stored == "gemini-1.5-pro") {
            return DEFAULT_MODEL
        }
        return stored
    }

    fun setModel(model: String) {
        val clean = model.trim()
        if (clean.isNotBlank()) {
            securityHelper.saveSecret(KEY_GEMINI_MODEL, clean)
        }
    }

    /**
     * Minimal lightweight probe to verify user's Google AI Studio API key.
     * Accepts candidateKey if user is testing a key in settings before saving.
     */
    fun testApiKey(candidateKey: String? = null): String {
        val key = candidateKey?.trim()?.takeIf { it.isNotBlank() }
            ?: securityHelper.getSecret(KEY_GEMINI_API_KEY)

        if (key.isNullOrBlank()) {
            return JSONObject().apply {
                put("status", "error")
                put("success", false)
                put("error", "No API key configured. Please paste a key from Google AI Studio.")
            }.toString()
        }

        val model = getModel()
        val url = "$API_BASE_URL/$model:generateContent?key=$key"

        val testPayload = JSONObject().apply {
            put("contents", JSONArray().apply {
                put(JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply { put("text", "Respond with: OK") })
                    })
                })
            })
            put("generationConfig", JSONObject().apply {
                put("maxOutputTokens", 5)
            })
        }

        val req = Request.Builder()
            .url(url)
            .post(testPayload.toString().toRequestBody(jsonMediaType))
            .build()

        return try {
            httpClient.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: ""
                if (resp.isSuccessful) {
                    JSONObject().apply {
                        put("status", "ok")
                        put("success", true)
                        put("model", model)
                        put("message", "Google AI Studio API ($model) connected successfully.")
                    }.toString()
                } else {
                    val code = resp.code
                    val googleDetail = try {
                        val errObj = JSONObject(body).optJSONObject("error")
                        errObj?.optString("message") ?: ""
                    } catch (_: Exception) { "" }

                    val errMsg = when (code) {
                        400 -> if (googleDetail.isNotBlank()) "HTTP 400: $googleDetail" else "Invalid API Key or malformed request (HTTP 400)."
                        403 -> if (googleDetail.isNotBlank()) "HTTP 403: $googleDetail" else "API Key lacks Gemini permission or project blocked (HTTP 403)."
                        404 -> if (googleDetail.isNotBlank()) "HTTP 404: $googleDetail" else "Model '$model' not found or API disabled (HTTP 404)."
                        429 -> if (googleDetail.isNotBlank()) "HTTP 429: $googleDetail" else "Rate limit or free quota exceeded (HTTP 429)."
                        else -> "API error HTTP $code: ${googleDetail.ifBlank { body }}"
                    }
                    JSONObject().apply {
                        put("status", "error")
                        put("success", false)
                        put("code", code)
                        put("error", errMsg)
                    }.toString()
                }
            }
        } catch (e: Exception) {
            JSONObject().apply {
                put("status", "error")
                put("success", false)
                put("error", "Network error: ${e.message ?: "Failed to connect to Google API"}")
            }.toString()
        }
    }

    /**
     * Executes prompt on Google Gemini API enforcing structured JSON response.
     */
    fun sendPrompt(userText: String, languageMode: String, contextJson: String): String {
        val key = securityHelper.getSecret(KEY_GEMINI_API_KEY)
        if (key.isNullOrBlank()) {
            return JSONObject().apply {
                put("error", "KEY_NOT_CONFIGURED")
                put("message", "Gemini API key is not configured. Switching to Offline AI parser.")
                put("message_gu", "Gemini API કી સેટ નથી. ઑફલાઇન AI નો ઉપયોગ કરવો.")
            }.toString()
        }

        val model = getModel()
        val url = "$API_BASE_URL/$model:generateContent?key=$key"

        val contextObj = try { JSONObject(contextJson) } catch (_: Exception) { JSONObject() }
        val personality = contextObj.optString("personality", "Standard")
        val responseLength = contextObj.optString("response_length", "normal")
        val historyArray = contextObj.optJSONArray("history")

        val personalityGuide = when (personality.lowercase()) {
            "friendly" -> "Tone: Warm, conversational, enthusiastic, and friendly like an intelligent personal companion."
            "professional" -> "Tone: Formal, precise, polite, concise, and business-focused."
            "futuristic" -> "Tone: Cyberpunk AI workstation persona (DESK OS AI Core), sleek, high-tech, sharp, and vigilant."
            "minimal" -> "Tone: Ultra-brief, strictly 1 single sentence, zero fluff."
            else -> "Tone: Natural, intelligent, helpful, empathetic, and direct."
        }

        val lengthGuide = when (responseLength.lowercase()) {
            "concise" -> "Response length: Strictly 1 sentence."
            "detailed" -> "Response length: 2-3 clear sentences with helpful context."
            else -> "Response length: 1-2 natural sentences."
        }

        val systemInstructionText = """
        You are DESK AI, an advanced, highly intelligent desktop AI assistant companion for DESK OS.
        You understand English, Gujarati (ગુજરાતી), and mixed Gujlish (e.g. 'મારું volume 50 ટકા કરી દે', 'Play Believer by Imagine Dragons').
        User preferred language: $languageMode.
        $personalityGuide
        $lengthGuide
        Context: $contextJson.

        You MUST ALWAYS return a SINGLE valid JSON object matching this schema EXACTLY:
        {
          "response_text": "Spoken response in English",
          "response_text_gu": "Spoken response in Gujarati (ગુજરાતી)",
          "action": "ALLOWED_ACTION_NAME",
          "parameters": {},
          "requires_confirmation": false
        }

        ALLOWED ACTIONS:
        - OPEN_APP: {"app_name": "App Name", "app_id": "app_id"}
        - SWITCH_APP: {"app_name": "App Name", "target_window_id": "window_id"}
        - CLOSE_APP: {"app_name": "App Name"} (requires_confirmation: true)
        - GET_PC_STATUS: {}
        - GET_GPU_STATUS: {}
        - SET_VOLUME: {"volume": 0..100}
        - MUTE_AUDIO: {"mute": true or false}
        - MEDIA_PLAY: {}
        - MEDIA_PAUSE: {}
        - MEDIA_NEXT: {}
        - MEDIA_PREVIOUS: {}
        - SEARCH_SONG: {"query": "Song and artist name"}
        - TAKE_SCREENSHOT: {}
        - LOCK_PC: {} (requires_confirmation MUST be true)
        - GET_RUNNING_APPS: {}
        - GET_TASKS: {}
        - CREATE_TASK: {"title": "Task title"}
        - CREATE_NOTE: {"content": "Note text"}
        - START_TIMER: {"duration_seconds": 60, "label": "Timer label"}
        - NONE: {}

        RULES:
        1. Understand natural references from prior conversation (e.g. 'it', 'that song', 'do it again', 'pause it', 'repeat').
        2. Always provide natural, fluent Gujarati translation in "response_text_gu".
        3. Never invent fake hardware metrics; if user asks about GPU, PC, or RAM, select GET_GPU_STATUS or GET_PC_STATUS so real hardware data is read.
        4. For sensitive actions like LOCK_PC or CLOSE_APP, set "requires_confirmation": true.
        5. If user request is ambiguous, set action to NONE and ask a friendly clarifying question.
        6. NEVER output arbitrary code, scripts, or markdown fences.
        """.trimIndent()

        val contentsList = JSONArray()

        // Append conversation history if available (limit to last 6 items for performance & free token budget)
        if (historyArray != null && historyArray.length() > 0) {
            val startIdx = (historyArray.length() - 6).coerceAtLeast(0)
            for (i in startIdx until historyArray.length()) {
                val item = historyArray.optJSONObject(i) ?: continue
                val role = item.optString("role", "user")
                val text = item.optString("text", "")
                if (text.isNotBlank()) {
                    contentsList.put(JSONObject().apply {
                        put("role", if (role == "assistant") "model" else "user")
                        put("parts", JSONArray().apply {
                            put(JSONObject().apply { put("text", text) })
                        })
                    })
                }
            }
        }

        // Current turn
        contentsList.put(JSONObject().apply {
            put("role", "user")
            put("parts", JSONArray().apply {
                put(JSONObject().apply { put("text", userText) })
            })
        })

        val requestPayload = JSONObject().apply {
            put("systemInstruction", JSONObject().apply {
                put("parts", JSONArray().apply {
                    put(JSONObject().apply { put("text", systemInstructionText) })
                })
            })
            put("contents", contentsList)
            put("generationConfig", JSONObject().apply {
                put("temperature", 0.2)
                put("maxOutputTokens", 512)
                put("responseMimeType", "application/json")
            })
        }

        val request = Request.Builder()
            .url(url)
            .post(requestPayload.toString().toRequestBody(jsonMediaType))
            .build()

        return try {
            httpClient.newCall(request).execute().use { resp ->
                val code = resp.code
                val respText = resp.body?.string() ?: ""

                if (resp.isSuccessful) {
                    val root = JSONObject(respText)
                    val candidates = root.optJSONArray("candidates")
                    if (candidates != null && candidates.length() > 0) {
                        val content = candidates.getJSONObject(0).optJSONObject("content")
                        val parts = content?.optJSONArray("parts")
                        if (parts != null && parts.length() > 0) {
                            val jsonString = parts.getJSONObject(0).optString("text")
                            return@use cleanAndValidateJson(jsonString)
                        }
                    }
                    JSONObject().apply {
                        put("error", "EMPTY_RESPONSE")
                        put("message", "Received empty response from Gemini API.")
                        put("message_gu", "Gemini API તરફથી ખાલી જવાબ મળ્યો.")
                    }.toString()
                } else {
                    when (code) {
                        429 -> JSONObject().apply {
                            put("error", "QUOTA_EXHAUSTED")
                            put("message", "Free Gemini quota exceeded (15 RPM). Switching to offline AI.")
                            put("message_gu", "મફત ક્વોટા સમાપ્ત થયો છે. ઑફલાઇન AI ચાલુ છે.")
                        }.toString()
                        400, 403 -> JSONObject().apply {
                            put("error", "AUTH_ERROR")
                            put("message", "Invalid Gemini API key or unauthorized (HTTP $code).")
                            put("message_gu", "અમાન્ય Gemini API કી (HTTP $code).")
                        }.toString()
                        else -> JSONObject().apply {
                            put("error", "API_ERROR")
                            put("code", code)
                            put("message", "Gemini API error (HTTP $code). Switching to offline parser.")
                            put("message_gu", "Gemini API ભૂલ આવી. ઑફલાઇન પાર્સર ઉપલબ્ધ છે.")
                        }.toString()
                    }
                }
            }
        } catch (e: IOException) {
            JSONObject().apply {
                put("error", "NETWORK_ERROR")
                put("message", "Network unreachable. Switching to offline rule parser.")
                put("message_gu", "ઇન્ટરનેટ ઉપલબ્ધ નથી. ઑફલાઇન પાર્સર ચાલુ છે.")
            }.toString()
        } catch (e: Exception) {
            JSONObject().apply {
                put("error", "UNEXPECTED_ERROR")
                put("message", e.message ?: "Failed to process AI response.")
                put("message_gu", "AI પ્રોસેસિંગમાં ભૂલ આવી.")
            }.toString()
        }
    }

    private fun cleanAndValidateJson(rawText: String): String {
        var clean = rawText.trim()
        if (clean.startsWith("```json")) clean = clean.removePrefix("```json")
        if (clean.startsWith("```")) clean = clean.removePrefix("```")
        if (clean.endsWith("```")) clean = clean.removeSuffix("```")
        clean = clean.trim()

        return try {
            val json = JSONObject(clean)
            // Ensure mandatory keys exist
            if (!json.has("response_text")) json.put("response_text", "Command acknowledged.")
            if (!json.has("response_text_gu")) json.put("response_text_gu", "આદેશ સ્વીકાર્યો.")
            if (!json.has("action")) json.put("action", "NONE")
            if (!json.has("parameters")) json.put("parameters", JSONObject())
            if (!json.has("requires_confirmation")) json.put("requires_confirmation", false)
            json.toString()
        } catch (_: Exception) {
            JSONObject().apply {
                put("response_text", clean)
                put("response_text_gu", clean)
                put("action", "NONE")
                put("parameters", JSONObject())
                put("requires_confirmation", false)
            }.toString()
        }
    }
}

