package net.datum.vpn

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * This device's Connector keys (Ed25519 seeds), one per project, sealed with
 * an AES key that never leaves the Android Keystore. The iOS module keeps the
 * same seeds in the Keychain.
 */
object ConnectorKeys {
  private const val PREFS = "net.datum.connect.keys"
  private const val ALIAS = "net.datum.connect.seal"

  /** The project's seed, generating one when [create] and none exists. */
  fun seed(context: Context, project: String, create: Boolean): ByteArray? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString(account(project), null)?.let { return open(it) }
    if (!create) return null
    val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
    prefs.edit().putString(account(project), seal(seed)).apply()
    return seed
  }

  private fun account(project: String) = "connector-key.$project"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun seal(plain: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.iv + cipher.doFinal(plain)
    return Base64.encodeToString(sealed, Base64.NO_WRAP)
  }

  private fun open(encoded: String): ByteArray {
    val sealed = Base64.decode(encoded, Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
    return cipher.doFinal(sealed, 12, sealed.size - 12)
  }
}
