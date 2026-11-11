package com.maandlee.carprint.connection

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** 앱 전용 Keystore 키. 키 손실/복호화 실패는 호출자에게 전달하고 빈 성공값으로 바꾸지 않는다. */
class DeviceVault(context: Context, private val alias: String = "carprint-local-v1") {
    private val preferences = context.getSharedPreferences("secure-local", Context.MODE_PRIVATE)
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(
                    KeyGenParameterSpec.Builder(
                            alias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
                generateKey()
            }
    }

    @Synchronized
    // 암호문 앞에 IV 붙여 Base64로 보관. IV는 매번 새로 만들고 AES 키는 Keystore에 둠. _ma
    fun encrypt(value: String): String {
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        return Base64.encodeToString(
            cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        )
    }

    @Synchronized
    // 앞 12바이트가 IV. 나머지 복호화하면서 GCM 인증도 확인. 키 없거나 변조됐으면 예외 그대로 넘김. _ma
    fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            }
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }

    @Synchronized
    fun put(name: String, value: String?) {
        val editor = preferences.edit()
        if (value == null) editor.remove(name) else editor.putString(name, encrypt(value))
        check(editor.commit()) { "SECURE_STORAGE_WRITE_FAILED" }
    }

    @Synchronized fun get(name: String): String? = preferences.getString(name, null)?.let(::decrypt)
}
