package io.crates.keyring

import android.content.Context

/**
 * Bridge for android-native-keyring-store's exported context initializer.
 * The shared library name is derived from the Rust cdylib target `app_lib`.
 */
class Keyring {
    companion object {
        init {
            System.loadLibrary("app_lib")
        }

        external fun initializeNdkContext(context: Context)
    }
}
