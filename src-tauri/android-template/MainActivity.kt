package com.lexicue.app

import android.os.Bundle
import android.webkit.WebView
import android.webkit.JavascriptInterface
import android.graphics.Color
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import io.crates.keyring.Keyring

/**
 * Initializes the Android context required by the native credential store
 * before Tauri starts Rust application setup.
 */
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        Keyring.initializeNdkContext(applicationContext)
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        // Resize the WebView's parent, so CSS viewport dimensions already exclude
        // system bars, cutouts and the IME. Do not add those insets a second time in JS.
        val content = findViewById<android.view.View>(android.R.id.content)
        // This local-only bridge coordinates system chrome and IME-first UI Back.
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun requestBack() {
                runOnUiThread { onBackPressedDispatcher.onBackPressed() }
            }

            @JavascriptInterface
            fun setDarkTheme(dark: Boolean) {
                runOnUiThread {
                    content.setBackgroundColor(Color.parseColor(if (dark) "#151820" else "#f8fafc"))
                    val controller = WindowCompat.getInsetsController(window, webView)
                    controller.isAppearanceLightStatusBars = !dark
                    controller.isAppearanceLightNavigationBars = !dark
                }
            }
        }, "LexiCueSystemUi")
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            // Keep dispatching updates, but zero what the native container has
            // already handled. Modern WebViews otherwise resize/pad a second time.
            // https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets
            WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build()
        }
        ViewCompat.requestApplyInsets(content)

        val callback = object : OnBackPressedCallback(true) {
            private var dispatching = false

            override fun handleOnBackPressed() {
                if (dispatching) return
                val insets = ViewCompat.getRootWindowInsets(webView)
                if (insets?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                    WindowCompat.getInsetsController(window, webView).hide(WindowInsetsCompat.Type.ime())
                    webView.clearFocus()
                    return
                }
                dispatching = true
                // The React coordinator reports synchronously whether a dialog,
                // page or folder owns Back. Pending saves consume subsequent Back.
                webView.evaluateJavascript("Boolean(window.__lexicueBack && window.__lexicueBack())") { handled ->
                    dispatching = false
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, callback)
    }
}
