package com.deskos.panel

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Android Keystore-backed secure storage for DESK OS credentials and device secrets.
 * Prevents plain-text token exposure on the file system or in web storage.
 * Gracefully falls back to private MODE_PRIVATE preferences if Keystore encounters provider anomalies.
 */
class SecurityHelper(context: Context) {

    private val sharedPreferences: SharedPreferences

    init {
        sharedPreferences = try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                SECURE_PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (_: Exception) {
            context.getSharedPreferences(FALLBACK_PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    fun saveSecret(key: String, value: String) {
        if (key.isNotBlank()) {
            sharedPreferences.edit().putString(key, value).apply()
        }
    }

    fun getSecret(key: String): String? {
        return sharedPreferences.getString(key, null)
    }

    fun removeSecret(key: String) {
        sharedPreferences.edit().remove(key).apply()
    }

    companion object {
        private const val SECURE_PREFS_NAME = "deskos_keystore_prefs"
        private const val FALLBACK_PREFS_NAME = "deskos_fallback_prefs"
    }
}
