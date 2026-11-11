package com.maandlee.carprint.connection

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class ApiFailure(val status: Int, val code: String) : Exception(code) {
    // 500(서버 결함)은 같은 요청을 다시 보내도 결과가 같으므로 재시도하지 않는다.
    val retryable: Boolean
        get() = status == 0 || status == 429 || status in 502..504
}

/** 동기 I/O. 호출자는 worker에서 실행해야 한다. 실패를 성공/빈 본문으로 치환하지 않는다. */
class HttpTransport {
    // Gateway 요청을 동기 HTTP로 보냄. 차량 자격이랑 개인 세션 헤더는 별개. 재시도 판단은 호출한 쪽에서. _ma
    fun request(
        baseUrl: String,
        path: String,
        token: String,
        method: String = "GET",
        body: String? = null,
        key: String? = null,
        personalToken: String? = null,
    ): JSONObject {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 5_000
            connection.readTimeout = 8_000
            // 리다이렉트 자동으로 안 따라감. 인증 헤더 들고 다른 주소까지 갈 필요 없음. _ma
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            personalToken?.let { connection.setRequestProperty("X-Personal-Session", it) }
            key?.let { connection.setRequestProperty("Idempotency-Key", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val content =
                (if (status in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()
                    ?.use { it.readText() }
                    .orEmpty()
            if (status !in 200..299)
                throw ApiFailure(
                    status,
                    runCatching { JSONObject(content).getString("error") }
                        .getOrDefault("http_error"),
                )
            return if (content.isBlank()) JSONObject() else JSONObject(content)
        } catch (failure: ApiFailure) {
            throw failure
        } catch (_: java.io.IOException) {
            throw ApiFailure(0, "network_unavailable")
        } finally {
            connection.disconnect()
        }
    }
}
