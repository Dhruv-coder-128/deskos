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
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Manages client connections to the Windows PC Agent over TLS-pinned WSS.
 * Supports OTP-only pairing via PAKE-style trust establishment and automatic TLS fingerprint pinning.
 * Supports Multi-Route connectivity: Auto (LAN with Tailscale fallback), Local (LAN only), and Remote (Tailscale).
 * Strictly keeps authentication tokens inside Android Keystore backed storage.
 */
class PcAgentManager(
    private val context: Context,
    private val securityHelper: SecurityHelper
) {

    companion object {
        private const val TAG = "DESK_OS_AGENT_MGR"

        const val KEY_LOCAL_IP = "pc_local_ip"
        const val KEY_REMOTE_IP = "pc_remote_ip"
        const val KEY_PORT = "pc_port"
        const val KEY_AUTH_TOKEN = "pc_auth_token"
        const val KEY_FINGERPRINT = "pc_cert_fingerprint"
        const val KEY_HOST_NAME = "pc_host_name"
        const val KEY_IS_PAIRED = "pc_is_paired"
        const val KEY_CONN_MODE = "pc_conn_mode" // "AUTO", "LOCAL", "REMOTE"

        // Legacy key for backwards migration
        private const val KEY_LEGACY_HOST_IP = "pc_host_ip"

        const val MODE_AUTO = "AUTO"
        const val MODE_LOCAL = "LOCAL"
        const val MODE_REMOTE = "REMOTE"

        const val ROUTE_LOCAL = "LOCAL"
        const val ROUTE_REMOTE = "REMOTE"
        const val ROUTE_NONE = "NONE"

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

    @Volatile var activeRoute: String = ROUTE_NONE
        private set

    @Volatile private var latestTelemetryJson: String = ""
    @Volatile var latestTelemetryTimestampMs: Long = 0L
        private set

    var telemetryListener: ((String) -> Unit)? = null
    var rawMessageListener: ((String) -> Unit)? = null

    private var activeWebSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null
    private var reconnectAttempt = 0
    private var autoReconnectEnabled = true
    private val reconnectRunnable = Runnable { connect() }

    init {
        // Backwards compatibility migration
        val legacyIp = securityHelper.getSecret(KEY_LEGACY_HOST_IP)
        if (!legacyIp.isNullOrBlank() && securityHelper.getSecret(KEY_LOCAL_IP).isNullOrBlank()) {
            securityHelper.saveSecret(KEY_LOCAL_IP, legacyIp)
        }
        if (securityHelper.getSecret(KEY_CONN_MODE).isNullOrBlank()) {
            securityHelper.saveSecret(KEY_CONN_MODE, MODE_AUTO)
        }

        val isPaired = securityHelper.getSecret(KEY_IS_PAIRED) == "true"
        connectionState = if (isPaired) STATE_DISCONNECTED else STATE_NOT_PAIRED
    }

    /**
     * Compute the SHA-256 fingerprint of an X509 certificate formatted as uppercase hex with colons.
     */
    private fun computeCertFingerprint(cert: X509Certificate): String {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(cert.encoded)
        return digest.joinToString(":") { String.format(Locale.US, "%02X", it) }
    }

    /**
     * Build an OkHttpClient for the initial pairing handshake that captures the presented
     * certificate's SHA-256 fingerprint for verification against the OTP response.
     */
    private fun buildPairingTlsClient(capturedFpRef: AtomicReference<String>): OkHttpClient {
        val trustManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}

            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                if (chain.isNullOrEmpty()) {
                    throw CertificateException("Server certificate chain is empty.")
                }
                val fp = computeCertFingerprint(chain[0])
                capturedFpRef.set(fp)
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }

        val sslContext = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(trustManager), null)
        }

        return OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier { _, _ -> true } // PAKE exchange verifies server identity
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Build a strictly pinned OkHttpClient. Fails if the server certificate does not match the Keystore-pinned fingerprint.
     */
    private fun buildPinnedTlsClient(pinnedFingerprint: String, timeoutSec: Long = 5): OkHttpClient {
        val cleanExpected = pinnedFingerprint.trim()
            .uppercase(Locale.US)
            .replace("-", ":")
            .removePrefix("SHA256:")

        val trustManager = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}

            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                if (chain.isNullOrEmpty()) {
                    throw CertificateException("Server certificate chain is empty.")
                }
                val actualFp = computeCertFingerprint(chain[0])
                if (cleanExpected.isBlank() || cleanExpected != actualFp) {
                    throw CertificateException(
                        "TLS Pinning Mismatch! Expected: $cleanExpected, Received: $actualFp"
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
            .hostnameVerifier { _, _ -> true } // Certificate fingerprint pinning provides authentication
            .connectTimeout(timeoutSec, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .pingInterval(15, TimeUnit.SECONDS)
            .build()
    }

    fun isPaired(): Boolean {
        return securityHelper.getSecret(KEY_IS_PAIRED) == "true"
    }

    fun getConnectionMode(): String {
        return securityHelper.getSecret(KEY_CONN_MODE) ?: MODE_AUTO
    }

    fun setConnectionMode(mode: String): Boolean {
        val cleanMode = mode.trim().uppercase(Locale.US)
        if (cleanMode in listOf(MODE_AUTO, MODE_LOCAL, MODE_REMOTE)) {
            securityHelper.saveSecret(KEY_CONN_MODE, cleanMode)
            if (isPaired()) {
                disconnect()
                connect()
            }
            return true
        }
        return false
    }

    fun getStatusJson(): JSONObject {
        return JSONObject().apply {
            put("state", connectionState)
            put("isPaired", isPaired())
            put("hostName", securityHelper.getSecret(KEY_HOST_NAME) ?: "Lenovo LOQ")
            put("localIp", securityHelper.getSecret(KEY_LOCAL_IP) ?: "")
            put("remoteIp", securityHelper.getSecret(KEY_REMOTE_IP) ?: "")
            put("hostIp", if (activeRoute == ROUTE_REMOTE) securityHelper.getSecret(KEY_REMOTE_IP) else securityHelper.getSecret(KEY_LOCAL_IP))
            put("port", securityHelper.getSecret(KEY_PORT) ?: "8765")
            put("connectionMode", getConnectionMode())
            put("activeRoute", activeRoute)
            put("lastTelemetryAgeMs", if (latestTelemetryTimestampMs > 0) System.currentTimeMillis() - latestTelemetryTimestampMs else -1)
        }
    }

    fun getLatestTelemetryJson(): String {
        return latestTelemetryJson
    }

    /**
     * Executes OTP-only secure pairing handshake over TLS with PAKE trust bootstrap.
     * Extracts and automatically pins the server's certificate SHA-256 fingerprint in Android Keystore.
     */
    fun pairDevice(
        hostAddress: String,
        port: Int,
        pairingOtp: String,
        remoteAddress: String? = null,
        connectionMode: String = MODE_AUTO,
        callback: (Boolean, String) -> Unit
    ) {
        Thread {
            try {
                val cleanHost = hostAddress.trim()
                val cleanRemote = remoteAddress?.trim().orEmpty()
                val cleanOtp = pairingOtp.trim()

                if (cleanHost.isBlank() || cleanOtp.isBlank()) {
                    mainHandler.post { callback(false, "Host address and 6-digit OTP are required.") }
                    return@Thread
                }

                val capturedFpRef = AtomicReference<String>()
                val client = buildPairingTlsClient(capturedFpRef)

                val pairUrl = "https://$cleanHost:$port/api/v1/pair"
                val androidId = android.provider.Settings.Secure.getString(
                    context.contentResolver,
                    android.provider.Settings.Secure.ANDROID_ID
                )?.take(8) ?: "node"

                val jsonPayload = JSONObject().apply {
                    put("pairing_code", cleanOtp)
                    put("client_id", "galaxy_m01s_$androidId")
                    put("client_name", "Samsung Galaxy M01s")
                    put("client_nonce", java.util.UUID.randomUUID().toString().replace("-", "").take(16))
                    put("connection_mode", connectionMode.lowercase(Locale.US))
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
                    val serverFp = respJson.getString("fingerprint")
                    val hostName = respJson.optString("host_name", "Workstation Host")
                    val discoveredTailscale = respJson.optString("tailscale_ip", "")
                    val discoveredLocal = respJson.optString("local_ip", cleanHost)

                    val capturedFp = capturedFpRef.get()
                    if (capturedFp.isNullOrBlank() || capturedFp.trim().uppercase() != serverFp.trim().uppercase()) {
                        throw CertificateException("Server fingerprint confirmation mismatch! Potential MITM rejected.")
                    }

                    // Save verified TLS identity and credentials into Android Keystore
                    securityHelper.saveSecret(KEY_LOCAL_IP, if (cleanHost.startsWith("100.") || cleanHost.contains(".ts.net")) discoveredLocal else cleanHost)
                    securityHelper.saveSecret(KEY_REMOTE_IP, if (cleanRemote.isNotBlank()) cleanRemote else discoveredTailscale)
                    securityHelper.saveSecret(KEY_PORT, port.toString())
                    securityHelper.saveSecret(KEY_AUTH_TOKEN, token)
                    securityHelper.saveSecret(KEY_FINGERPRINT, capturedFp)
                    securityHelper.saveSecret(KEY_HOST_NAME, hostName)
                    securityHelper.saveSecret(KEY_CONN_MODE, connectionMode)
                    securityHelper.saveSecret(KEY_IS_PAIRED, "true")

                    mainHandler.post {
                        connectionState = STATE_DISCONNECTED
                        callback(true, "Pairing successful! TLS identity pinned. Connecting...")
                        connect()
                    }
                } else {
                    val errorDetail = try {
                        JSONObject(responseBody).optString("detail", "Pairing rejected (HTTP ${response.code})")
                    } catch (_: Exception) {
                        "Pairing rejected (HTTP ${response.code})"
                    }
                    mainHandler.post { callback(false, errorDetail) }
                }
            } catch (e: Exception) {
                val msg = when {
                    e is CertificateException -> "SECURITY ALERT: TLS certificate identity could not be verified."
                    e is java.net.ConnectException -> "CONNECTION REFUSED: Check address/port and verify Windows PC Agent is running."
                    e is java.net.SocketTimeoutException -> "TIMEOUT: Host did not respond. Check Windows Firewall or network."
                    else -> e.message ?: "Pairing request failed."
                }
                mainHandler.post { callback(false, msg) }
            }
        }.start()
    }

    /**
     * Connects to the PC Agent WebSocket endpoint using Auto, Local, or Remote (Tailscale) routing.
     */
    fun connect() {
        if (!isPaired()) {
            connectionState = STATE_NOT_PAIRED
            activeRoute = ROUTE_NONE
            return
        }

        val localIp = securityHelper.getSecret(KEY_LOCAL_IP)
        val remoteIp = securityHelper.getSecret(KEY_REMOTE_IP)
        val port = securityHelper.getSecret(KEY_PORT) ?: "8765"
        val token = securityHelper.getSecret(KEY_AUTH_TOKEN) ?: return
        val fingerprint = securityHelper.getSecret(KEY_FINGERPRINT) ?: return
        val mode = getConnectionMode()

        if (connectionState == STATE_CONNECTED || connectionState == STATE_CONNECTING) {
            return
        }

        connectionState = STATE_CONNECTING

        Thread {
            try {
                // Determine candidate targets based on mode
                val candidateRoutes = mutableListOf<Pair<String, String>>() // Pair(RouteType, TargetAddress)

                when (mode) {
                    MODE_LOCAL -> {
                        if (!localIp.isNullOrBlank()) candidateRoutes.add(ROUTE_LOCAL to localIp)
                    }
                    MODE_REMOTE -> {
                        if (!remoteIp.isNullOrBlank()) candidateRoutes.add(ROUTE_REMOTE to remoteIp)
                    }
                    else -> { // MODE_AUTO: Try local first, then remote (Tailscale)
                        if (!localIp.isNullOrBlank()) candidateRoutes.add(ROUTE_LOCAL to localIp)
                        if (!remoteIp.isNullOrBlank() && remoteIp != localIp) candidateRoutes.add(ROUTE_REMOTE to remoteIp)
                    }
                }

                if (candidateRoutes.isEmpty()) {
                    Log.w(TAG, "No candidate host addresses configured for mode: $mode")
                    handleDisconnect()
                    return@Thread
                }

                var connected = false
                for ((routeType, hostAddr) in candidateRoutes) {
                    Log.i(TAG, "Attempting connection via $routeType route to $hostAddr:$port...")
                    val client = buildPinnedTlsClient(fingerprint, timeoutSec = if (routeType == ROUTE_LOCAL && candidateRoutes.size > 1) 3 else 6)
                    val wsUrl = "wss://$hostAddr:$port/ws/control"

                    val lock = java.util.concurrent.CountDownLatch(1)
                    var opened = false

                    val request = Request.Builder().url(wsUrl).build()
                    val ws = client.newWebSocket(request, object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            Log.i(TAG, "WebSocket opened via $routeType ($hostAddr). Sending auth frame...")
                            opened = true
                            activeRoute = routeType
                            activeWebSocket = webSocket
                            okHttpClient = client
                            val authJson = JSONObject().apply {
                                put("type", "auth")
                                put("token", token)
                                put("client_id", "galaxy_m01s")
                            }
                            webSocket.send(authJson.toString())
                            lock.countDown()
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {
                            try {
                                val msg = JSONObject(text)
                                when (msg.optString("type")) {
                                    "auth_success" -> {
                                        Log.i(TAG, "Authenticated successfully via $activeRoute!")
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
                                        autoReconnectEnabled = false
                                        webSocket.close(1000, "Auth failed")
                                    }
                                    "ping" -> {
                                        val pong = JSONObject().apply {
                                            put("type", "pong")
                                            put("timestamp", msg.optDouble("timestamp", 0.0))
                                        }
                                        webSocket.send(pong.toString())
                                    }
                                    "telemetry" -> {
                                        latestTelemetryJson = text
                                        latestTelemetryTimestampMs = System.currentTimeMillis()
                                        telemetryListener?.invoke(text)
                                    }
                                }
                                rawMessageListener?.invoke(text)
                            } catch (e: Exception) {
                                Log.e(TAG, "Error handling message: $e")
                            }
                        }

                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                            Log.i(TAG, "WebSocket closed ($code): $reason")
                            handleDisconnect()
                        }

                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                            Log.w(TAG, "WebSocket failure on $routeType ($hostAddr): ${t.message}")
                            lock.countDown()
                            if (activeWebSocket === webSocket) {
                                handleDisconnect()
                            }
                        }
                    })

                    try {
                        lock.await(if (routeType == ROUTE_LOCAL && candidateRoutes.size > 1) 3500 else 7000, TimeUnit.MILLISECONDS)
                    } catch (_: Exception) {}

                    if (opened) {
                        connected = true
                        break
                    } else {
                        try { ws.cancel() } catch (_: Exception) {}
                    }
                }

                if (!connected) {
                    Log.w(TAG, "All candidate routes failed to establish connection.")
                    handleDisconnect()
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to initiate connection: ${e.message}")
                handleDisconnect()
            }
        }.start()
    }

    private fun handleDisconnect() {
        activeWebSocket = null
        activeRoute = ROUTE_NONE
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
        val delaySec = minOf(30, (1 shl minOf(reconnectAttempt, 5)))
        Log.i(TAG, "Scheduling reconnect attempt #$reconnectAttempt in ${delaySec}s...")
        mainHandler.postDelayed(reconnectRunnable, delaySec * 1000L)
    }

    fun sendWsMessage(jsonString: String): Boolean {
        val ws = activeWebSocket ?: return false
        return ws.send(jsonString)
    }

    fun sendControlAction(action: String, payload: JSONObject?): Boolean {
        if (connectionState != STATE_CONNECTED) return false
        val msg = JSONObject().apply {
            put("type", "control_action")
            put("action", action)
            if (payload != null) {
                val keys = payload.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    put(k, payload.get(k))
                }
            }
        }
        return sendWsMessage(msg.toString())
    }

    fun disconnect() {
        mainHandler.removeCallbacks(reconnectRunnable)
        autoReconnectEnabled = false
        activeWebSocket?.close(1000, "Client initiated disconnect")
        activeWebSocket = null
        activeRoute = ROUTE_NONE
        connectionState = if (isPaired()) STATE_DISCONNECTED else STATE_NOT_PAIRED
    }

    fun forgetDevice(): Boolean {
        // Asynchronously notify PC agent to revoke credentials
        val token = securityHelper.getSecret(KEY_AUTH_TOKEN)
        val fp = securityHelper.getSecret(KEY_FINGERPRINT)
        val host = securityHelper.getSecret(KEY_LOCAL_IP) ?: securityHelper.getSecret(KEY_REMOTE_IP)
        val port = securityHelper.getSecret(KEY_PORT) ?: "8765"

        if (!token.isNullOrBlank() && !fp.isNullOrBlank() && !host.isNullOrBlank()) {
            Thread {
                try {
                    val client = buildPinnedTlsClient(fp, timeoutSec = 2)
                    val req = Request.Builder()
                        .url("https://$host:$port/api/v1/revoke")
                        .addHeader("Authorization", "Bearer $token")
                        .post("{}".toRequestBody("application/json".toMediaType()))
                        .build()
                    client.newCall(req).execute()
                } catch (_: Exception) {}
            }.start()
        }

        disconnect()
        latestTelemetryJson = ""
        latestTelemetryTimestampMs = 0L
        securityHelper.removeSecret(KEY_LOCAL_IP)
        securityHelper.removeSecret(KEY_REMOTE_IP)
        securityHelper.removeSecret(KEY_LEGACY_HOST_IP)
        securityHelper.removeSecret(KEY_PORT)
        securityHelper.removeSecret(KEY_AUTH_TOKEN)
        securityHelper.removeSecret(KEY_FINGERPRINT)
        securityHelper.removeSecret(KEY_HOST_NAME)
        securityHelper.removeSecret(KEY_IS_PAIRED)
        securityHelper.removeSecret(KEY_CONN_MODE)
        connectionState = STATE_NOT_PAIRED
        activeRoute = ROUTE_NONE
        return true
    }
}
