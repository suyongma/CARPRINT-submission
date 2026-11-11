package com.maandlee.carprint.connection

import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/** 네트워크/저장소를 worker에서 수행하고 결과만 main으로 전달. 화면 재생성 중 작업은 유지한다. */
class UiWorkScope {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var closed = false

    // I/O는 worker 하나로 돌리고 결과만 main에 줌. closed는 UI 콜백 막는 거지 진행 중 요청 취소는 아님. _ma
    fun <T> run(action: () -> T, success: (T) -> Unit, failure: (Exception) -> Unit) {
        if (closed) return
        executor.execute {
            try {
                val result = action()
                main.post { if (!closed) success(result) }
            } catch (error: Exception) {
                main.post { if (!closed) failure(error) }
            }
        }
    }

    // 새 작업 막고 남은 큐 뒤에 after 넣음. shutdown이 실행 중 작업을 끊는 건 아니라 정리 순서 유지됨. _ma
    fun close(after: () -> Unit = {}) {
        closed = true
        executor.execute(after)
        executor.shutdown()
    }
}

fun errorMessage(error: Exception): String =
    when (error) {
        is ApiFailure ->
            when (error.status) {
                0 -> "서버 연결을 확인해 주세요. 아직 저장 성공으로 처리하지 않았습니다."
                401,
                403 -> "시연 연결 또는 권한 확인이 필요합니다. 자동 전송을 중단했습니다."
                409,
                412 -> "서버 기록이 변경되었습니다. 최신 상태를 확인해 주세요."
                422 -> "입력 범위와 기록 정보를 확인해 주세요."
                else -> "서버가 요청을 완료하지 못했습니다. 잠시 후 다시 확인해 주세요."
            }
        else -> "기기 저장소 또는 연결 설정을 확인해 주세요. 자료를 복구한 것으로 처리하지 않았습니다."
    }
