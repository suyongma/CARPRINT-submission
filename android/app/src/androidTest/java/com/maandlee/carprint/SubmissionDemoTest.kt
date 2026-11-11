package com.maandlee.carprint

import android.graphics.Bitmap
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.hamcrest.Matcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 명시적으로 요청한 제출 검증에서만 실행한다. release APK의 첫 연결과 실제 화면 조작을 검사한다. 참여 코드는 instrumentation 인자로만 받아
 * 저장·로그·스크린샷에 남기지 않는다. 전용 합성 DB의 공통/차량별 선호와 프리셋을 시연 값으로 저장하므로 일반 테스트에는 포함하지 않는다.
 */
@RunWith(AndroidJUnit4::class)
class SubmissionDemoTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val events = JSONArray()
    private val pacedCapture
        get() = InstrumentationRegistry.getArguments().getString("pacedCapture") == "true"
    private val context
        get() = instrumentation.targetContext

    @Test
    fun exportCaptureMetadata() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("exportCapture") == "true")
        val metadata = File(folder, "scenes.json").readText()
        instrumentation.sendStatus(
            0,
            android.os.Bundle().apply { putString("captureMetadata", metadata) },
        )
    }

    @Test
    fun captureReportFlow() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("reportCapture") == "true")
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            see(s, "평가 보류")
            nav(s, R.id.nav_history)
            waitFor(s) { it.any { v -> v.text.startsWith("#") } }
            shot(s, "report-01-server-history")
            nav(s, R.id.nav_reports)
            press(s, "리포트 발급")
            see(s, "공유 중")
            shot(s, "report-02-shared", "공유 중")
            press(s, "공유 취소")
            confirm("공유 취소")
            see(s, "공유 취소됨")
            shot(s, "report-03-revoked", "공유 취소됨")
        }
    }

    private val folder
        get() = File(context.getExternalFilesDir(null), "submission-capture").apply { mkdirs() }

    private fun views(view: View): List<View> = buildList {
        add(view)
        if (view is ViewGroup) repeat(view.childCount) { addAll(views(view.getChildAt(it))) }
    }

    private fun waitFor(s: ActivityScenario<MainActivity>, predicate: (List<TextView>) -> Boolean) {
        val until = SystemClock.elapsedRealtime() + 45000
        while (true) {
            var ready = false
            s.onActivity {
                ready = predicate(views(it.window.decorView).filterIsInstance<TextView>())
            }
            if (ready) return
            assertTrue("Submission UI state timeout", SystemClock.elapsedRealtime() < until)
            Thread.sleep(100)
        }
    }

    private fun see(s: ActivityScenario<MainActivity>, text: String) =
        waitFor(s) { it.any { v -> v.text.contains(text) } }

    private fun focus(s: ActivityScenario<MainActivity>, text: String, last: Boolean = false) {
        s.onActivity { a ->
            val matches =
                views(a.window.decorView).filterIsInstance<TextView>().filter {
                    it.text.toString() == text
                }
            val v = if (last) matches.last() else matches.first()
            val scroll = a.findViewById<ScrollView>(R.id.content_scroll)
            val rect = android.graphics.Rect()
            v.getDrawingRect(rect)
            scroll.offsetDescendantRectToMyCoords(v, rect)
            scroll.scrollTo(0, (rect.top - 20).coerceAtLeast(0))
        }
        instrumentation.waitForIdleSync()
    }

    private fun press(s: ActivityScenario<MainActivity>, text: String, last: Boolean = false) {
        waitFor(s) {
            it.filterIsInstance<Button>().any { v -> v.text.toString() == text && v.isEnabled }
        }
        focus(s, text, last)
        Thread.sleep(if (pacedCapture) 950 else 250)
        s.onActivity { a ->
            val matches =
                views(a.window.decorView).filterIsInstance<Button>().filter {
                    it.text.toString() == text
                }
            (if (last) matches.last() else matches.first()).performClick()
        }
        if (pacedCapture) Thread.sleep(500)
    }

    private fun nav(s: ActivityScenario<MainActivity>, id: Int) {
        s.onActivity { it.findViewById<Button>(id).performClick() }
        if (pacedCapture) Thread.sleep(850)
    }

    private fun shot(
        s: ActivityScenario<MainActivity>,
        name: String,
        anchor: String? = null,
        last: Boolean = false,
    ) {
        if (anchor != null) focus(s, anchor, last)
        Thread.sleep(500)
        val start = SystemClock.elapsedRealtime()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(folder, "$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
        Thread.sleep(if (pacedCapture) 4500 else 3500)
        events.put(
            JSONObject()
                .put("scene", name)
                .put("fromMs", start)
                .put("toMs", SystemClock.elapsedRealtime())
        )
        File(folder, "scenes.json").writeText(events.toString(2))
    }

    private fun confirm(text: String) {
        if (pacedCapture) Thread.sleep(900)
        onView(withText(text)).inRoot(isDialog()).perform(click())
        if (pacedCapture) Thread.sleep(500)
    }

    private fun login(s: ActivityScenario<MainActivity>, account: String, seat: String?) {
        see(s, "새 개인 연결")
        s.onActivity { a ->
            views(a.window.decorView).filterIsInstance<CheckBox>().forEach {
                it.isChecked = it.text.toString() in listOf("공조 선호", "좌석 위치·열선·통풍 선호")
            }
        }
        press(s, "선택 항목으로 연결 요청")
        press(s, "임시 계정 $account" + "로 승인")
        confirm("선택 범위 승인")
        see(s, "임시 계정 $account")
        waitFor(s) {
            it.any { v -> v.contentDescription == "개인 종합 점수 ${if(account == "A")69 else 50}점" }
        }
        if (seat != null) press(s, seat, true)
    }

    private fun editValues(temperature: String, preset: Boolean = false) {
        onView(isRoot())
            .inRoot(isDialog())
            .perform(
                object : ViewAction {
                    override fun getConstraints(): Matcher<View> = isRoot()

                    override fun getDescription() = "Set synthetic values in the visible input form"

                    override fun perform(ui: UiController, root: View) {
                        val values = listOf(temperature, "60%", "60%", "3단계", "2단계")
                        views(root).filterIsInstance<Spinner>().forEachIndexed { index, spinner ->
                            val position =
                                (0 until spinner.count).first {
                                    spinner.getItemAtPosition(it).toString() == values[index]
                                }
                            spinner.setSelection(position)
                        }
                        if (preset)
                            views(root).filterIsInstance<EditText>().first().setText("시연 동승자")
                        ui.loopMainThreadUntilIdle()
                    }
                }
            )
        Thread.sleep(if (pacedCapture) 2300 else 1200)
        confirm("입력값 저장")
    }

    private fun resetOverrideIfPresent(s: ActivityScenario<MainActivity>) {
        var found = false
        s.onActivity {
            found =
                views(it.window.decorView).filterIsInstance<Button>().any {
                    it.text.toString() == "이 차량 저장값 대신 내 공통 선호 사용"
                }
        }
        if (found) {
            press(s, "이 차량 저장값 대신 내 공통 선호 사용")
            confirm("공통 선호 사용")
            see(s, "차량에 맞춘 설정 확인 완료")
        }
    }

    @Test
    fun freshReleaseConnectsAndDemonstratesOnlineJourney() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("submissionCapture") == "true")
        val code = requireNotNull(args.getString("participationCode"))
        demonstrateOnlineJourney(code)
    }

    @Test
    fun captureConnectedReleaseJourney() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("pacedCapture") == "true")
        demonstrateOnlineJourney()
    }

    private fun demonstrateOnlineJourney(code: String? = null) {
        context.getSharedPreferences("appearance", 0).edit().putString("theme", "light").commit()
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            if (code != null) {
                see(s, "시연 시작하기")
                s.onActivity { a ->
                    views(a.window.decorView)
                        .filterIsInstance<EditText>()
                        .first { it.hint == "시연 참여 코드" }
                        .setText(code)
                }
                press(s, "시연 서버에 연결")
            }
            see(s, "평가 보류")
            assertFalse(
                context.applicationInfo.flags and
                    android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
            )
            if (context.packageName.endsWith(".pleos")) {
                shot(s, "pleos-01-sdk-observation")
                nav(s, R.id.nav_space)
                login(s, "A", null)
                press(s, "차량별 맞춤 설정 불러오기")
                see(s, "지원 범위·쓰기 권한 미검증")
                shot(s, "pleos-02-control-blocked", "차가 달라도, 나에게 맞게")
                press(s, "모든 개인 연결 종료")
                see(s, "원격 종료 확인 완료")
                return
            }
            shot(s, "01-vehicle-evidence")
            press(s, "합성 평가 예제 보기")
            confirm("관리 점수 95점")
            see(s, "95점")
            shot(s, "02-synthetic-care-score")
            nav(s, R.id.nav_space)
            see(s, "임시 계정 준비됨")
            shot(s, "03-selective-login", "새 개인 연결")
            login(s, "A", "운전석")
            shot(s, "04-personal-score-69", "임시 계정 A")
            press(s, "차량별 맞춤 설정 불러오기")
            see(s, "차량에 맞춘 설정 확인 완료")
            resetOverrideIfPresent(s)
            press(s, "내 공통 선호 편집·저장")
            editValues("29.5°C")
            see(s, "29.5°C")
            shot(s, "05-vehicle-a-preferences", "차가 달라도, 나에게 맞게")
            press(s, "차량 맞춤 적용 전 확인")
            press(s, "지원 항목만 모의 적용")
            see(s, "마지막 모의 적용 결과")
            shot(s, "06-a-mock-apply", "마지막 모의 적용 결과")
            press(s, "합성 차량 B")
            nav(s, R.id.nav_space)
            see(s, "임시 계정 준비됨")
            login(s, "A", "운전석")
            shot(s, "07-b-same-personal-score", "임시 계정 A")
            press(s, "차량별 맞춤 설정 불러오기")
            see(s, "B · 패밀리 6")
            resetOverrideIfPresent(s)
            see(s, "28°C")
            shot(s, "08-b-capability-migration", "차가 달라도, 나에게 맞게")
            press(s, "이 차량·이 좌석만 편집·저장")
            editValues("23°C")
            see(s, "23°C")
            shot(s, "09-b-only-save", "차가 달라도, 나에게 맞게")
            press(s, "동승자 프리셋 만들기·덮어쓰기")
            editValues("29.5°C", true)
            see(s, "시연 동승자")
            shot(s, "10-driver-preset", "동승자 프리셋")
            press(s, "다른 계정 연결")
            login(s, "B", "조수석")
            shot(s, "11-passenger-score-50", "임시 계정 B")
            press(s, "차량별 맞춤 설정 불러오기", true)
            see(s, "시연 동승자을 이 좌석에 불러오기")
            press(s, "시연 동승자을 이 좌석에 불러오기")
            confirm("선택 범위 불러오기")
            see(s, "차량에 맞춘 설정 확인 완료")
            shot(s, "12-passenger-adapted", "차가 달라도, 나에게 맞게", true)
            press(s, "모든 개인 연결 종료")
            see(s, "원격 종료 확인 완료")
            shot(s, "13-session-ended")
            press(s, "합성 차량 A")
            nav(s, R.id.nav_space)
            see(s, "임시 계정 준비됨")
            login(s, "A", "운전석")
            press(s, "차량별 맞춤 설정 불러오기")
            see(s, "29.5°C")
            shot(s, "14-a-preferences-retained", "차가 달라도, 나에게 맞게")
            press(s, "모든 개인 연결 종료")
            see(s, "원격 종료 확인 완료")
            nav(s, R.id.nav_history)
            waitFor(s) { it.any { v -> v.text.startsWith("#") } }
            shot(s, "15-server-history")
            nav(s, R.id.nav_reports)
            see(s, "기록을 공유하다")
            shot(s, "16-report-options")
        }
    }
}
