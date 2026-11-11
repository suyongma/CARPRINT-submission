package com.maandlee.carprint

import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StageSevenUiTest {
    private fun texts(view: View): List<TextView> = buildList {
        if (view is TextView) add(view)
        if (view is ViewGroup) repeat(view.childCount) { addAll(texts(view.getChildAt(it))) }
    }

    private fun waitFor(scenario: ActivityScenario<MainActivity>, test: (MainActivity) -> Boolean) {
        val end = System.currentTimeMillis() + 15000
        while (true) {
            var ready = false
            scenario.onActivity { ready = test(it) }
            if (ready) return
            assertTrue("UI did not reach expected state", System.currentTimeMillis() < end)
            Thread.sleep(100)
        }
    }

    private fun capture(scenario: ActivityScenario<MainActivity>, name: String) {
        scenario.onActivity { activity ->
            val root = activity.window.decorView
            val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bitmap))
            val folder = File(activity.filesDir, "stage7-review").apply { mkdirs() }
            File(folder, "$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
    }

    @Test
    fun saveBrowseIssueAndThemeRecreationPreserveReport() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("appearance", 0).edit().putString("theme", "light").commit()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitFor(scenario) { it.findViewById<Button>(R.id.save_observation).isEnabled }
            scenario.onActivity { it.findViewById<Button>(R.id.save_observation).performClick() }
            waitFor(scenario) {
                it.findViewById<TextView>(R.id.upload_status).text.contains("서버 저장 #")
            }
            capture(scenario, "01-vehicle-light")
            scenario.onActivity { it.findViewById<Button>(R.id.nav_history).performClick() }
            waitFor(scenario) { texts(it.window.decorView).any { t -> t.text.contains("서버 동기화") } }
            capture(scenario, "02-history-light")
            scenario.onActivity { it.findViewById<Button>(R.id.nav_reports).performClick() }
            waitFor(scenario) { it.findViewById<Button>(R.id.issue_report)?.isEnabled == true }
            capture(scenario, "03-report-form-light")
            scenario.onActivity { it.findViewById<Button>(R.id.issue_report).performClick() }
            waitFor(scenario) {
                texts(it.window.decorView).any { t -> t.text.toString() == "공유 중" }
            }
            scenario.onActivity {
                it.findViewById<ScrollView>(R.id.content_scroll).fullScroll(View.FOCUS_DOWN)
            }
            capture(scenario, "04-report-issued-light")
            var issuedText = ""
            scenario.onActivity {
                issuedText =
                    texts(it.window.decorView)
                        .first { t -> t.text.startsWith("발급 ") }
                        .text
                        .toString()
            }
            context.getSharedPreferences("appearance", 0).edit().putString("theme", "dark").commit()
            scenario.recreate()
            waitFor(scenario) {
                texts(it.window.decorView).any { t -> t.text.toString() == issuedText }
            }
            scenario.onActivity {
                assertEquals(
                    Configuration.UI_MODE_NIGHT_YES,
                    it.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK,
                )
            }
            capture(scenario, "05-report-issued-dark")
            context
                .getSharedPreferences("appearance", 0)
                .edit()
                .putString("theme", "system")
                .commit()
        }
    }
}
