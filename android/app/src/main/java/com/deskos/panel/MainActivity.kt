package com.deskos.panel

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.AssetsPathHandler

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var powerHelper: PowerHelper
    private lateinit var sensorHelper: SensorHelper
    private lateinit var notificationHelper: NotificationHelper
    private lateinit var securityHelper: SecurityHelper
    private lateinit var pcAgentManager: PcAgentManager
    private lateinit var assetLoader: WebViewAssetLoader

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        powerHelper = PowerHelper(this)
        sensorHelper = SensorHelper(this)
        notificationHelper = NotificationHelper(this)
        securityHelper = SecurityHelper(this)
        pcAgentManager = PcAgentManager(this, securityHelper)

        // Configure hardened WebViewAssetLoader (serves local assets under virtual HTTPS origin)
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            clearCache(true)

            // Bind sanitized native bridge to the local dashboard
            addJavascriptInterface(
                NativeBridge(this@MainActivity, powerHelper, sensorHelper, notificationHelper, pcAgentManager),
                "DeskOSBridge"
            )

            // WebChromeClient enables console logging for diagnostics in Logcat
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    consoleMessage?.let {
                        Log.d("DESK_OS_WEB", "${it.sourceId()}:${it.lineNumber()} [${it.messageLevel()}]: ${it.message()}")
                    }
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val url = request?.url ?: return null
                    return assetLoader.shouldInterceptRequest(url)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val url = request?.url?.toString().orEmpty()
                    // Block all navigation requests outside the virtual internal origin
                    if (url.startsWith("https://appassets.androidplatform.net/")) {
                        return false
                    }
                    return true
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    Log.e("DESK_OS_WEB", "WebView error: ${error?.description} on ${request?.url}")
                }
            }
        }

        setContentView(webView)

        // Wire real-time telemetry dispatch to WebView safely quoted against unescaped emojis/newlines
        pcAgentManager.telemetryListener = { jsonStr ->
            runOnUiThread {
                val quoted = org.json.JSONObject.quote(jsonStr)
                webView.evaluateJavascript("window.onDeskOSTelemetry && window.onDeskOSTelemetry(JSON.parse($quoted));", null)
            }
        }

        // Wire all incoming control, volume, apps, and screenshot frames safely quoted
        pcAgentManager.rawMessageListener = { jsonStr ->
            runOnUiThread {
                val quoted = org.json.JSONObject.quote(jsonStr)
                webView.evaluateJavascript("window.onDeskOSMessage && window.onDeskOSMessage(JSON.parse($quoted));", null)
            }
        }

        // Setup kiosk window insets AFTER decorView is attached to the view hierarchy
        setupKioskWindow()

        // Load the locally bundled DESK OS dashboard (with version parameter to guarantee cache refresh)
        webView.loadUrl("https://appassets.androidplatform.net/assets/dashboard/index.html?v=1.1.0")
    }

    private fun setupKioskWindow() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // AndroidX WindowCompat handles Edge-to-Edge across Android 11 (API 30) up to Android 16 (API 36)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onResume() {
        super.onResume()
        powerHelper.startListening()
        sensorHelper.startListening()
        webView.onResume()
        setupKioskWindow()

        // Auto-reconnect if device is paired
        if (pcAgentManager.isPaired()) {
            pcAgentManager.connect()
        }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        setupKioskWindow()
    }

    override fun onPause() {
        super.onPause()
        sensorHelper.stopListening()
        powerHelper.stopListening()
        webView.onPause()
        restoreDefaultBrightness()
    }

    override fun onStop() {
        super.onStop()
        restoreDefaultBrightness()
    }

    override fun onDestroy() {
        super.onDestroy()
        restoreDefaultBrightness()
        pcAgentManager.disconnect()
        webView.destroy()
    }

    fun restoreDefaultBrightness() {
        try {
            val lp = window.attributes
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            window.attributes = lp
        } catch (_: Exception) {}
    }
}
