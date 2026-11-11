package com.maandlee.carprint

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StageNineUiTest {
    private fun texts(view: View): List<TextView> = buildList {
        if (view is TextView) add(view)
        if (view is ViewGroup) repeat(view.childCount) { addAll(texts(view.getChildAt(it))) }
    }

    private fun waitFor(
        scenario: ActivityScenario<MainActivity>,
        predicate: (List<TextView>) -> Boolean,
    ) {
        val end = System.currentTimeMillis() + 20000
        while (true) {
            var ready = false
            scenario.onActivity { ready = predicate(texts(it.window.decorView)) }
            if (ready) return
            assertTrue("UI state timeout", System.currentTimeMillis() < end)
            Thread.sleep(100)
        }
    }

    private fun press(scenario: ActivityScenario<MainActivity>, label: String) {
        waitFor(scenario) { list ->
            list.filterIsInstance<Button>().any { it.text.toString() == label && it.isEnabled }
        }
        scenario.onActivity { a ->
            texts(a.window.decorView)
                .filterIsInstance<Button>()
                .first { it.text.toString() == label }
                .performClick()
        }
    }

    private fun capture(
        scenario: ActivityScenario<MainActivity>,
        name: String,
        down: Boolean = false,
        anchor: String? = null,
    ) {
        if (anchor != null) {
            scenario.onActivity { a ->
                val target = texts(a.window.decorView).first { it.text.toString() == anchor }
                val scroll = a.findViewById<ScrollView>(R.id.content_scroll)
                val rect = android.graphics.Rect()
                target.getDrawingRect(rect)
                scroll.offsetDescendantRectToMyCoords(target, rect)
                scroll.scrollTo(0, rect.top)
            }
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        }
        if (down)
            scenario.onActivity {
                it.findViewById<ScrollView>(R.id.content_scroll).fullScroll(View.FOCUS_DOWN)
            }
        scenario.onActivity { a ->
            val root = a.window.decorView
            val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bitmap))
            val folder = File(a.filesDir, "stage9-review").apply { mkdirs() }
            File(folder, "$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
    }

    @Test
    fun careAndSelectiveApprovalAreVisibleAndEndClearsPersonalView() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("appearance", 0).edit().putString("theme", "light").commit()
        context.getSharedPreferences("demo-context", 0).edit().putString("selected", "a:a").commit()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitFor(scenario) { list -> list.any { it.text.toString() == "평가 보류" } }
            capture(scenario, "01-current-withheld")
            press(scenario, "합성 평가 예제 보기")
            onView(withText("관리 점수 95점")).inRoot(isDialog()).perform(click())
            waitFor(scenario) { list -> list.any { it.text.toString() == "95점" } }
            capture(scenario, "02-example-score")
            scenario.onActivity { it.findViewById<Button>(R.id.nav_space).performClick() }
            waitFor(scenario) { list -> list.any { it.text.contains("임시 계정 준비됨") } }
            capture(scenario, "03-selective-connection")
            scenario.onActivity { a ->
                texts(a.window.decorView)
                    .filterIsInstance<CheckBox>()
                    .first { it.text.toString() == "공조 선호" }
                    .isChecked = true
            }
            scenario.onActivity { a ->
                texts(a.window.decorView)
                    .filterIsInstance<CheckBox>()
                    .firstOrNull { it.text.toString() == "좌석 위치·열선·통풍 선호" }
                    ?.isChecked = true
            }
            press(scenario, "선택 항목으로 연결 요청")
            waitFor(scenario) { list -> list.any { it.text.startsWith("연결 확인 코드") } }
            capture(scenario, "04-approval-code")
            press(scenario, "임시 계정 A로 승인")
            onView(withText("선택 범위 승인")).inRoot(isDialog()).perform(click())
            waitFor(scenario) { list -> list.any { it.text.toString() == "임시 계정 A" } }
            scenario.onActivity { a ->
                assertFalse(
                    texts(a.window.decorView).any { it.text.toString().startsWith("미디어 음량 ·") }
                )
            }
            scenario.onActivity { a ->
                val labels = texts(a.window.decorView)
                assertTrue(labels.any { it.contentDescription == "개인 종합 점수 69점" })
                assertTrue(labels.any { it.text.contains("주행 습관  74점") })
                assertTrue(labels.any { it.text.contains("관리 이행  64점") })
            }
            capture(scenario, "05-connected-account")
            if (context.packageName.endsWith(".demo")) press(scenario, "운전석")
            press(scenario, "차량별 맞춤 설정 불러오기")
            waitFor(scenario) { list -> list.any { it.text.contains("차량에 맞춘 설정 확인 완료") } }
            press(scenario, "차량 맞춤 적용 전 확인")
            if (context.packageName.endsWith(".demo")) {
                press(scenario, "지원 항목만 모의 적용")
                waitFor(scenario) { list ->
                    list.any { it.text.toString() == "마지막 모의 적용 결과" } &&
                        list.none { it.text.startsWith("확인할 변환 결과") }
                }
            } else waitFor(scenario) { list -> list.any { it.text.contains("지원 범위·쓰기 권한 미검증") } }
            capture(scenario, "06-application-result", anchor = "차가 달라도, 나에게 맞게")
            press(scenario, "임시 계정 A 이용 종료")
            waitFor(scenario) { list -> list.any { it.text.contains("원격 종료 확인 완료") } }
            scenario.onActivity { a ->
                assertFalse(texts(a.window.decorView).any { it.text.toString() == "임시 계정 A" })
                assertFalse(
                    texts(a.window.decorView).any {
                        it.contentDescription?.startsWith("개인 종합 점수") == true
                    }
                )
            }
            capture(scenario, "07-ended")
            if (context.packageName.endsWith(".demo")) {
                press(scenario, "합성 차량 B")
                scenario.onActivity { it.findViewById<Button>(R.id.nav_space).performClick() }
                waitFor(scenario) { list -> list.any { it.text.contains("임시 계정 준비됨") } }
                scenario.onActivity { a ->
                    texts(a.window.decorView)
                        .filterIsInstance<CheckBox>()
                        .filter { it.text.toString() in listOf("공조 선호", "좌석 위치·열선·통풍 선호") }
                        .forEach { it.isChecked = true }
                }
                press(scenario, "선택 항목으로 연결 요청")
                press(scenario, "임시 계정 A로 승인")
                onView(withText("선택 범위 승인")).inRoot(isDialog()).perform(click())
                press(scenario, "운전석")
                press(scenario, "차량별 맞춤 설정 불러오기")
                waitFor(scenario) { list -> list.any { it.text.toString() == "B · 패밀리 6" } }
                scenario.onActivity { a ->
                    assertTrue(texts(a.window.decorView).any { it.text.contains("통풍 미지원") })
                    assertTrue(
                        texts(a.window.decorView).any { it.contentDescription == "개인 종합 점수 69점" }
                    )
                }
                capture(scenario, "09-vehicle-b-migration", anchor = "차가 달라도, 나에게 맞게")
                press(scenario, "임시 계정 A 이용 종료")
                waitFor(scenario) { list -> list.any { it.text.contains("원격 종료 확인 완료") } }
                press(scenario, "합성 차량 A")
                scenario.onActivity { it.findViewById<Button>(R.id.nav_space).performClick() }
                waitFor(scenario) { list -> list.any { it.text.contains("임시 계정 준비됨") } }
            }

            press(scenario, "선택 항목으로 연결 요청")
            press(scenario, "임시 계정 B로 승인")
            onView(withText("선택 범위 승인")).inRoot(isDialog()).perform(click())
            waitFor(scenario) { list -> list.any { it.contentDescription == "개인 종합 점수 50점" } }
            scenario.onActivity { a ->
                assertTrue(texts(a.window.decorView).any { it.text.contains("평가 전 · 시작값") })
                assertFalse(
                    texts(a.window.decorView).any { it.contentDescription == "개인 종합 점수 69점" }
                )
            }
            capture(scenario, "08-new-account-baseline")
            press(scenario, "임시 계정 B 이용 종료")
            waitFor(scenario) { list -> list.any { it.text.contains("원격 종료 확인 완료") } }
        }
    }
}
