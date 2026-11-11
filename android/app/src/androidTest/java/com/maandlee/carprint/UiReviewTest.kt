package com.maandlee.carprint

import android.content.res.Configuration
import android.view.LayoutInflater
import android.widget.LinearLayout
import com.maandlee.carprint.vehicle.*
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** 실제 Activity 렌더를 테스트 산출물로 저장한다. 목업 데이터를 제품 앱에 넣지 않는다. */
@RunWith(AndroidJUnit4::class)
class UiReviewTest {
    @Test fun exportScreensAndCheckTouchTargets() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val deadline = System.currentTimeMillis() + 12000
            while (true) {
                var ready = false
                scenario.onActivity { ready = it.findViewById<TextView>(R.id.distance_status).text.contains("km") }
                if (ready) break
                assertTrue("Vehicle reading did not arrive", System.currentTimeMillis() < deadline)
                Thread.sleep(100)
            }
            // Pleos 런처의 외부 창 배치 전환이 끝난 뒤 테스트 터치를 시작한다.
            Thread.sleep(1500)
            onView(withId(R.id.refresh_distance)).perform(click())
            val retryDeadline = System.currentTimeMillis() + 12000
            while (true) {
                var ready = false
                scenario.onActivity { ready = it.findViewById<TextView>(R.id.distance_status).text.contains("km") }
                if (ready) break
                assertTrue("Refresh did not return a value", System.currentTimeMillis() < retryDeadline)
                Thread.sleep(100)
            }
            capture(scenario, "vehicle")
            onView(withId(R.id.nav_history)).perform(click())
            capture(scenario, "history")
            onView(withId(R.id.nav_space)).perform(click())
            capture(scenario, "space")
        }
    }

    @Test fun compactLayoutWithLargeTextCanScrollWithoutShrinkingControls() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val configuration = Configuration(instrumentation.targetContext.resources.configuration).apply {
                screenWidthDp = 800
                screenHeightDp = 600
                smallestScreenWidthDp = 600
                densityDpi = 160
                fontScale = 1.3f
            }
            val context = android.view.ContextThemeWrapper(
                instrumentation.targetContext.createConfigurationContext(configuration), R.style.Theme_Carprint)
            val root = LayoutInflater.from(context).inflate(R.layout.activity_main, null)
            root.findViewById<LinearLayout>(R.id.screen_content).showMyVehicle(
                DistanceState.Idle, {})
            root.measure(View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY))
            root.layout(0, 0, 800, 600)
            listOf(R.id.nav_vehicle, R.id.nav_history, R.id.nav_space, R.id.refresh_distance).forEach {
                assertTrue(root.findViewById<View>(it).height >= 76)
            }
            assertTrue(root.findViewById<View>(R.id.nav_vehicle).bottom <= root.height)
            val bitmap = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.drawColor(context.getColor(R.color.background))
            root.draw(canvas)
            val directory = File(instrumentation.targetContext.filesDir, "ui-review").apply { mkdirs() }
            File(directory, "compact-layout.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }

    private fun capture(scenario: ActivityScenario<MainActivity>, name: String) {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        scenario.onActivity { activity ->
            val root = activity.window.decorView
            val density = activity.resources.displayMetrics.density
            listOf(R.id.nav_vehicle, R.id.nav_history, R.id.nav_space).forEach { id ->
                val target = activity.findViewById<View>(id)
                assertTrue("Touch target height", target.height / density >= 76)
                assertTrue("Touch target width", target.width / density >= 76)
            }
            activity.findViewById<View>(R.id.refresh_distance)?.let {
                assertTrue("Refresh touch target", it.height / density >= 76)
            }
            val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bitmap))
            // adb run-as로 꺼내는 로컬 검토 파일. 제품 데이터 저장 경로가 아니다.
            val directory = File(activity.filesDir, "ui-review").apply { mkdirs() }
            File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
}
