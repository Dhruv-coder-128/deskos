package com.deskos.panel

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Manages the client connection to the Windows PC Agent over TLS-pinned WSS.
 * Keeps authentication tokens strictly inside native Android Keystore storage.
 * Enforces exponential backoff, heartbeat management, and state notifications.
 */
class PcAgentManager(
    private val context: Context,
    private val securityHelper: SecurityHelper
) {

    companion object {
        private const val TAG = "DESK_OS_AGENT_MGR"
        private const val KEY_HOST_IP = "pc_host_ip"
        private const val KEY_PORT = "pc_port"
        private const val KEY_AUTH_TOKEN = "pc_auth_token"
        private const val KEY_FINGERPRINT = "pc_cert_fingerprint"
        private const val KEY_HOST_NAME = "pc_host_name"
        private const val KEY_IS_PAIRED = "pc_is_paired"

        const val STATE_NOT_PAIRED = "NOT_PAIRED"
        const val STATE_CONNECTING = "CONNECTING"
        const val STATE_CONNECTED = "CONNECTED"
        const val STATE_DISCONNECTED = "DISCONNECTED"
        const val STATE_AUTH_FAILED = "AUTH_FAILED"
        const val STATE_OFFLINE = "OFFLINE"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile var connectionState: String = STATE_NOT_PAIRED
        private set

    private var activeWebSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null
    private var reconnectAttempt = 0
    private var autoReconnectEnabled = true
    private val reconnectRunnable = Runnable { connect() }

    init {
        val isPaired = securityHelper.getSecret(KEY_IS_PAIRED) == "true"
        connectionState = if (isPaired) STATE_DISCONNECTED else STATE_NOT_PAIRED
    }

    private fun buildTlsClient(pinnedFingerprint: String?): OkHttpClient {
        val trustManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}

            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                if (chain.isNullOrEmpty()) {
                    throw CertificateException("Server certificate chain is empty.")
                }

                val serverCert = chain[0]
                val md = MessageDigest.getInstance("SHA-256")
                val digest = md.digest(serverCert.encoded)
                val actualFp = digest.joinToString(":") { String.format(Locale.US, "%02X", it) }

                val cleanExpected = pinnedFingerprint?.trim()
                    ?.uppercase(Locale.US)
                    ?.replace("-", ":")
                    ?.removePrefix("SHA256:")

                val cleanActual = actualFp.trim().uppercase(Locale.US)

                if (cleanExpected.isNullOrBlank() || cleanExpected != cleanActual) {
                    throw CertificateException(
                        "TLS Fingerprint mismatch! Expected: $cleanExpected, Received: $cleanActual"
                    )
                }
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }

        val sslContext = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(trustManager), null)
        }

        return OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier { _, _ -> true } // Pinned certificate fingerprint validates the identity
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .pingInterval(15, TimeUnit.SECONDS)
            .build()
    }

    fun isPaired(): Boolean {
        return securityHelper.getSecret(KEY_IS_PAIRED) == "true"
    }

    fun getStatusJson(): JSONObject {
        return JSONObject().apply {
            put("state", connectionState)
            put("isPaired", isPaired())
            put("hostName", securityHelper.getSecret(KEY_HOST_NAME) ?: "Lenovo LOQ")
            put("hostIp", securityHelper.getSecret(KEY_HOST_IP) ?: "")
            put("port", securityHelper.getSecret(KEY_PORT) ?: "8765")
        }
    }

    /**
     * Executes the secure first-time pairing handshake over TLS with fingerprint verification.
     */
    fun pairDevice(
        hostIp: String,
        port: Int,
        pairingCode: String,
        fingerprint: String,
        callback: (Boolean, String) -> Unit
    ) {
        Thread {
            try {
                val cleanIp = hostIp.trim()
                val cleanFp = fingerprint.trim()
                val client = buildTlsClient(cleanFp)

                val pairUrl = "https://$cleanIp:$port/api/v1/pair"
                val jsonPayload = JSONObject().apply {
                    put("pairing_code", pairingCode.trim())
                    val androidId = android.provider.Settings.Secure.getString(
                        context.contentResolver,
                        android.provider.Settings.Secure.ANDROID_ID
                    )?.take(8) ?: "node"
                    put("client_id", "galaxy_m01s_$androidId")
                    put("client_name", "Samsung Galaxy M01s")
                }

                val body = jsonPayload.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url(pairUrl)
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string().orEmpty()

                if (response.isSuccessful) {
                    val respJson = JSONObject(responseBody)
                    val token = respJson.getString("auth_token")
                    val hostName = respJson.optString("host_name", "Workstation Host")

                    // Store credentials securely in Android Keystore backed storage
                    securityHelper.saveSecret(KEY_HOST_IP, cleanIp)
                    securityHelper.saveSecret(KEY_PORT, port.toString())
                    securityHelper.saveSecret(KEY_AUTH_TOKEN, token)
                    securityHelper.saveSecret(KEY_FINGERPRINT, cleanFp)
                    securityHelper.saveSecret(KEY_HOST_NAME, hostName)
                    securityHelper.saveSecret(KEY_IS_PAIRED, "true")

                    mainHandler.post {
                        connectionState = STATE_DISCONNECTED
                        callback(true, "Pairing successful! Connecting to host...")
                        connect()
                    }
                } else {
                    val errorDetail = try {
                        JSONObject(responseBody).optString("detail", "Pairing rejected (HTTP ${response.code})")
                    } catch (_: Exception) {
                        "Pairing rejected (HTTP ${response.code})"
                    }
                    mainHandler.post {
                        callback(false, errorDetail)
                    }
                }
            } catch (e: Exception) {
                val msg = when {
                    e.cause is CertificateException || e is CertificateException ->
                        "TLS FINGERPRINT MISMATCH: Server certificate does not match entered fingerprint."
                    e is java.net.ConnectException ->
                        "CONNECTION REFUSED: Check IP/port and verify Windows agent is running."
                    e is java.net.SocketTimeoutException ->
                        "TIMEOUT: Host did not respond. Check Windows Firewall or network."
                    else -> e.message ?: "Pairing request failed."
                }
                mainHandler.post {
                    callback(false, msg)
                }
            }
        }.start()
    }

    /**
     * Connects to the PC Agent WebSocket endpoint.
     */
    fun connect() {
        if (!isPaired()) {
            connectionState = STATE_NOT_PAIRED
            return
        }

        val hostIp = securityHelper.getSecret(KEY_HOST_IP) ?: return
        val port = securityHelper.getSecret(KEY_PORT) ?: "8765"
        val token = securityHelper.getSecret(KEY_AUTH_TOKEN) ?: return
        val fingerprint = securityHelper.getSecret(KEY_FINGERPRINT) ?: return

        if (connectionState == STATE_CONNECTED || connectionState == STATE_CONNECTING) {
            return
        }

        connectionState = STATE_CONNECTING
        Log.i(TAG, "Connecting to PC Agent at wss://$hostIp:$port/ws/control...")

        Thread {
            try {
                okHttpClient = buildTlsClient(fingerprint)
                val wsUrl = "wss://$hostIp:$port/ws/control"

                val request = Request.Builder()
                    .url(wsUrl)
                    .build()

                activeWebSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        Log.i(TAG, "WebSocket opened. Sending first-frame authentication token...")
                        // First frame authentication
                        val authJson = JSONObject().apply {
                            put("type", "auth")
                            put("token", token)
                            put("client_id", "galaxy_m01s")
                        }
                        webSocket.send(authJson.toString())
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        try {
                            val msg = JSONObject(text)
                            when (msg.optString("type")) {
                                "auth_success" -> {
                                    Log.i(TAG, "Authenticated successfully with PC Agent!")
                                    connectionState = STATE_CONNECTED
                                    reconnectAttempt = 0
                                    val hostName = msg.optString("host_name")
                                    if (hostName.isNotBlank()) {
                                        securityHelper.saveSecret(KEY_HOST_NAME, hostName)
                                    }
                                }
                                "auth_error" -> {
                                    Log.w(TAG, "Authentication rejected by PC Agent: ${msg.optString("message")}")
                                    connectionState = STATE_AUTH_FAILED
                                    autoReconnectEnabled = false // Don't loop on bad auth
                                    webSocket.close(1000, "Auth failed")
                                }
                                "ping" -> {
                                    val pong = JSONObject().apply {
                                        put("type", "pong")
                                        put("timestamp", msg.optDouble("timestamp", 0.0))
                                    }
                                    webSocket.send(pong.toString())
                                }
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Error handling message: $e")
                        }
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        Log.i(TAG, "WebSocket closing ($code): $reason")
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        Log.i(TAG, "WebSocket closed ($code): $reason")
                        handleDisconnect()
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        Log.w(TAG, "WebSocket failure: ${t.message}")
                        handleDisconnect()
                    }
                })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initiate WebSocket connection: ${e.message}")
                handleDisconnect()
            }
        }.start()
    }

    private fun handleDisconnect() {
        activeWebSocket = null
        if (connectionState != STATE_AUTH_FAILED) {
            connectionState = STATE_OFFLINE
        }

        if (autoReconnectEnabled && isPaired() && connectionState != STATE_AUTH_FAILED) {
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        mainHandler.removeCallbacks(reconnectRunnable)
        reconnectAttempt++
        // Exponential backoff: 2s, 4s, 8s, 16s, up to 30s
        val delaySec = minOf(30, (1 shl minOf(reconnectAttempt, 5)))
        Log.i(TAG, "Scheduling reconnect attempt #$reconnectAttempt in ${delaySec}s...")
        mainHandler.postDelayed(reconnectRunnable, delaySec * 1000L)
    }

    fun disconnect() {
        mainHandler.removeCallbacks(reconnectRunnable)
        autoReconnectEnabled = false
        activeWebSocket?.close(1000, "Client initiated disconnect")
        activeWebSocket = null
        connectionState = if (isPaired()) STATE_DISCONNECTED else STATE_NOT_PAIRED
    }

    fun forgetDevice(): Boolean {
        disconnect()
        securityHelper.removeSecret(KEY_HOST_IP)
        securityHelper.removeSecret(KEY_PORT)
        securityHelper.removeSecret(KEY_AUTH_TOKEN)
        securityHelper.removeSecret(KEY_FINGERPRINT)
        securityHelper.removeSecret(KEY_HOST_NAME)
        securityHelper.removeSecret(KEY_IS_PAIRED)
        connectionState = STATE_NOT_PAIRED
        return true
    }
}

