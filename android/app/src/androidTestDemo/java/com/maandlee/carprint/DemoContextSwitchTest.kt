package com.maandlee.carprint

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.reports.*
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DemoContextSwitchTest {
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun texts(view: View): List<TextView> = buildList {
        if (view is TextView) add(view)
        if (view is ViewGroup) repeat(view.childCount) { addAll(texts(view.getChildAt(it))) }
    }

    private fun waitFor(
        scenario: ActivityScenario<MainActivity>,
        condition: (MainActivity) -> Boolean,
    ) {
        val end = System.currentTimeMillis() + 15000
        while (true) {
            var ready = false
            scenario.onActivity { ready = condition(it) }
            if (ready) return
            assertTrue("Context switch timeout", System.currentTimeMillis() < end)
            Thread.sleep(100)
        }
    }

    private fun choose(scenario: ActivityScenario<MainActivity>, label: String, expected: String) {
        scenario.onActivity { activity ->
            texts(activity.window.decorView)
                .filterIsInstance<Button>()
                .first { it.text.toString() == label }
                .performClick()
        }
        waitFor(scenario) {
            it.findViewById<TextView>(R.id.active_context).text.toString() == expected
        }
    }

    private fun capture(scenario: ActivityScenario<MainActivity>, name: String) {
        scenario.onActivity { activity ->
            val root = activity.window.decorView
            val image = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(image))
            val folder = File(activity.filesDir, "stage7-review").apply { mkdirs() }
            File(folder, name).outputStream().use {
                image.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            image.recycle()
        }
    }

    @Test
    fun changingVehicleAndUserPreservesSeparateBindingAndEnforcesReportPermission() {
        val preferences = context.getSharedPreferences("demo-context", Context.MODE_PRIVATE)
        preferences.edit().putString("selected", "a:a").commit()
        val stableA = BackendConnectionStore(context, DeviceVault(context), "simulation", "a:a")
        val a = requireNotNull(stableA.load())
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                waitFor(scenario) {
                    it.findViewById<TextView>(R.id.active_context).text.toString() ==
                        "합성 차량 A · 사용자 A"
                }
                scenario.onActivity { it.findViewById<Button>(R.id.nav_space).performClick() }
                choose(scenario, "합성 차량 B", "합성 차량 B · 사용자 A")
                scenario.onActivity { activity ->
                    assertFalse(texts(activity.window.decorView).any { it.text.contains("선호 온도") })
                }
                capture(scenario, "06-vehicle-b-user-a.png")
                // 전환 이전 작업이 참조하던 연결은 여전히 A. 새로운 연결만 B를 선택한다.
                assertEquals(a.vehicleRef, stableA.load()!!.vehicleRef)
                val b =
                    BackendConnectionStore(context, DeviceVault(context), "simulation", "b:a")
                        .load()!!
                assertNotEquals(a.vehicleRef, b.vehicleRef)
                choose(scenario, "사용자 B", "합성 차량 B · 사용자 B")
                scenario.onActivity { activity ->
                    assertFalse(texts(activity.window.decorView).any { it.text.contains("선호 온도") })
                }
                capture(scenario, "07-vehicle-b-user-b.png")
                scenario.onActivity { it.findViewById<Button>(R.id.nav_reports).performClick() }
                waitFor(scenario) {
                    texts(it.window.decorView).any {
                        it.text.toString() == "현재 사용자는 차량 기록 조회만 가능합니다."
                    }
                }
                scenario.onActivity { assertNull(it.findViewById<View>(R.id.issue_report)) }
                capture(scenario, "08-user-b-permission.png")
                val readOnly =
                    BackendConnectionStore(context, DeviceVault(context), "simulation", "b:b")
                        .load()!!
                try {
                    HttpReportGateway(HttpTransport())
                        .create(
                            readOnly,
                            ReportDraft(
                                "full",
                                "2026-01-01T00:00:00Z",
                                "2099-01-01T00:00:00Z",
                                emptyList(),
                                3600,
                            ),
                            UUID.randomUUID().toString(),
                        )
                    fail("Server must enforce permission independently of UI")
                } catch (failure: ApiFailure) {
                    assertEquals(403, failure.status)
                }
                scenario.onActivity { it.findViewById<Button>(R.id.nav_space).performClick() }
                choose(scenario, "합성 차량 A", "합성 차량 A · 사용자 B")
                scenario.onActivity { activity ->
                    assertFalse(texts(activity.window.decorView).any { it.text.contains("선호 온도") })
                }
                choose(scenario, "사용자 A", "합성 차량 A · 사용자 A")
                scenario.onActivity { it.findViewById<Button>(R.id.nav_history).performClick() }
                waitFor(scenario) { texts(it.window.decorView).any { it.text.contains("서버 동기화") } }
                scenario.onActivity { activity ->
                    assertTrue(
                        texts(activity.window.decorView).any { it.text.contains("수집 공백 1개") }
                    )
                }
            }
        } finally {
            preferences.edit().putString("selected", "a:a").commit()
        }
    }
}
