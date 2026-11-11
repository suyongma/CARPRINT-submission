package com.maandlee.carprint.personalization

import com.maandlee.carprint.connection.DeviceVault
import org.json.JSONArray

/** 종료 재전송용 불투명 ID만 영속화. 개인 토큰·이름·선호·좌석·목적지는 디스크에 저장하지 않는다. */
class PersonalSessionJournal(private val vault: DeviceVault, private val namespace: String) {
    @Synchronized
    fun entries(): List<String> {
        val array = JSONArray(vault.get("$namespace:cleanup") ?: "[]")
        return (0 until array.length()).map(array::getString)
    }

    @Synchronized
    // 응답에서 받은 정리용 ID만 중복 없이 암호화 저장. 프로세스 죽어도 다음 실행 때 서버 세션 닫으려고 둠. _ma
    fun remember(kind: String, id: String) {
        write((entries() + "$kind:$id").distinct())
    }

    @Synchronized
    fun forget(kind: String, id: String) {
        write(entries().filterNot { it == "$kind:$id" })
    }

    private fun write(entries: List<String>) {
        vault.put(
            "$namespace:cleanup",
            if (entries.isEmpty()) null else JSONArray(entries).toString(),
        )
    }
}
