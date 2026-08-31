package com.lexicue.app

import android.os.Bundle
import io.crates.keyring.Keyring

/**
 * Initializes the Android context required by the native credential store
 * before Tauri starts Rust application setup.
 */
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        Keyring.initializeNdkContext(applicationContext)
        super.onCreate(savedInstanceState)
    }
}
