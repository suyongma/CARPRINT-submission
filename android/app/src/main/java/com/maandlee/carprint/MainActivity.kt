package com.maandlee.carprint

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.widget.*
import com.maandlee.carprint.connection.showDemoSetup
import com.maandlee.carprint.demo.showDemoContextSwitcher
import com.maandlee.carprint.driving.showDrivingEvidence
import com.maandlee.carprint.personalization.showPersonalization
import com.maandlee.carprint.reports.showReports
import com.maandlee.carprint.ui.*
import com.maandlee.carprint.vehicle.*
import com.maandlee.carprint.vehiclehistory.showVehicleHistory

/** 탐색·화면 수명주기만 담당. SDK/HTTP/저장소의 조립은 AppGraph에 모은다. */
class MainActivity : Activity() {
    private enum class Destination(val buttonId: Int) {
        VEHICLE(R.id.nav_vehicle),
        HISTORY(R.id.nav_history),
        REPORTS(R.id.nav_reports),
        SPACE(R.id.nav_space),
    }

    private var discardGraph = false
    private var selected = Destination.VEHICLE
    private var distanceState: DistanceState = DistanceState.Idle
    private lateinit var vehicleRead: VehicleReadController
    private lateinit var graph: AppGraph
    private var readingView: VehicleReadingView? = null

    override fun attachBaseContext(base: Context) {
        val preference =
            base.getSharedPreferences("appearance", MODE_PRIVATE).getString("theme", "system")
        val override =
            when (preference) {
                "light" -> Configuration.UI_MODE_NIGHT_NO
                "dark" -> Configuration.UI_MODE_NIGHT_YES
                else -> null
            }
        if (override == null) super.attachBaseContext(base)
        else
            super.attachBaseContext(
                base.createConfigurationContext(
                    Configuration(base.resources.configuration).apply {
                        uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or override
                    }
                )
            )
    }

    // 재생성되면 AppGraph랑 화면 위치 복구. 거리 읽기는 Activity가 flavor별 factory 받아 따로 들고 있음. _ma
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        graph = (lastNonConfigurationInstance as? AppGraph) ?: AppGraph(applicationContext)
        selected =
            Destination.entries.firstOrNull {
                it.name == savedInstanceState?.getString("selected_destination")
            } ?: Destination.VEHICLE
        Destination.entries.forEach { destination ->
            findViewById<Button>(destination.buttonId).setOnClickListener { navigate(destination) }
        }
        graph.onChanged = {
            updateActiveContext()
            render()
        }
        vehicleRead =
            VehicleReadController(
                { createVehicleAdapter(this) },
                onState = { state ->
                    distanceState = state
                    readingView?.update(state)
                    updateUpload()
                },
            )
        render()
        if (lastNonConfigurationInstance == null) graph.reports.restore()
        val scroll = savedInstanceState?.getInt("scroll_y") ?: 0
        findViewById<ScrollView>(R.id.content_scroll).post {
            findViewById<ScrollView>(R.id.content_scroll).scrollTo(0, scroll)
        }
    }

    override fun onStart() {
        super.onStart()
        vehicleRead.refresh()
        graph.upload.retry()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (
            requestCode == 402 &&
                grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED
        )
            graph.driving.start()
    }

    // 진짜 화면 나가면 개인 화면 잠그고 속도 관측 끝냄. 테마 변경 재생성은 제외. 거리 읽기는 둘 다 중단. _ma
    override fun onStop() {
        // 화면 모드 변경 등 재생성 중에는 graph가 유지되므로 진행 중인 속도 관측을 끊지 않는다.
        if (!isChangingConfigurations) {
            graph.personal.lock()
            graph.driving.stop()
        }
        vehicleRead.stop()
        distanceState = DistanceState.Idle
        super.onStop()
    }

    // 이 Activity 물고 있는 콜백 끊음. 재생성이면 graph 유지, 차량/사용자 전환이면 자원까지 정리. _ma
    override fun onDestroy() {
        graph.onChanged = {}
        if (!isChangingConfigurations || discardGraph) graph.close()
        super.onDestroy()
    }

    @Deprecated("Activity retention for framework View prototype")
    override fun onRetainNonConfigurationInstance(): Any? = if (discardGraph) null else graph

    private fun navigate(destination: Destination) {
        selected = destination
        render()
        findViewById<ScrollView>(R.id.content_scroll).scrollTo(0, 0)
        if (destination == Destination.HISTORY) {
            graph.history.selected.clear()
            graph.history.selected.addAll(graph.reports.selectedIds)
            graph.history.load()
        }
        if (destination == Destination.REPORTS) graph.reports.loadList()
    }

    // controller 상태 보고 화면 그림. 연결 정보 없으면 일단 첫 실행 화면부터. _ma
    private fun render() {
        val scroll = findViewById<ScrollView>(R.id.content_scroll)
        val scrollY = scroll.scrollY
        readingView = null
        updateActiveContext()
        findViewById<LinearLayout>(R.id.screen_content).apply {
            if (!graph.setup.configured) {
                showDemoSetup(graph.setup)
                return@apply
            }
            when (selected) {
                Destination.VEHICLE -> {
                    readingView =
                        showMyVehicle(distanceState, { vehicleRead.refresh() }, graph.care) {
                            showObservationActions()
                        }
                    showDrivingEvidence(graph.driving) {
                        val permission = "android.car.permission.CAR_SPEED"
                        if (
                            packageName.endsWith(".pleos") &&
                                checkSelfPermission(permission) !=
                                    android.content.pm.PackageManager.PERMISSION_GRANTED
                        )
                            requestPermissions(arrayOf(permission), 402)
                        else graph.driving.start()
                    }
                    updateUpload()
                }
                Destination.HISTORY ->
                    showVehicleHistory(
                        graph.history,
                        { navigate(Destination.REPORTS) },
                        graph.reports::select,
                    )
                Destination.REPORTS ->
                    showReports(
                        graph.reports,
                        graph.reports.selectedIds,
                        graph.demo.current?.canManageReports ?: true,
                    )
                Destination.SPACE -> {
                    showPersonalization(graph.personal)
                    showDemoContextSwitcher(graph.demo) { vehicle, user ->
                        if (graph.demo.select(vehicle, user)) {
                            // 차 바꾸면 graph도 새로 만듦. 남은 작업은 원래 차량 쪽에서 정리. _ma
                            discardGraph = true
                            graph.onChanged = {}
                            recreate()
                        }
                    }
                    divider()
                    addView(context.label("화면 모드", 25f, R.color.text_primary, true))
                    addView(context.label("기본은 차량·기기 설정을 따릅니다. 여기서는 CARPRINT 화면에만 적용합니다.", 18f))
                    val preference = getSharedPreferences("appearance", MODE_PRIVATE)
                    listOf("system" to "차량·기기 설정 따르기", "light" to "화이트", "dark" to "다크").forEach {
                        (mode, label) ->
                        addView(
                            context.recordButton(
                                (if (preference.getString("theme", "system") == mode) "✓  "
                                else "") + label
                            ) {
                                preference.edit().putString("theme", mode).apply()
                                recreate()
                            }
                        )
                    }
                }
            }
        }
        Destination.entries.forEach {
            findViewById<Button>(it.buttonId).isSelected = it == selected
        }
        scroll.post { scroll.scrollTo(0, scrollY) }
    }

    private fun LinearLayout.showObservationActions() {
        divider()
        addView(context.label("기록 보관", 23f, R.color.text_primary, true).apply {
            isAccessibilityHeading = true
        })
        addView(context.label(graph.upload.status, 18f).apply {
            id = R.id.upload_status
            accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        })
        space(12)
        addView(
            context.recordButton("이번 관측 기록 저장") { graph.upload.save(distanceState) }
                .apply { id = R.id.save_observation },
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
        space(8)
        addView(
            context.recordButton("대기 기록 전송 재시도") { graph.upload.retry(manual = true) },
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
    }

    private fun updateActiveContext() {
        findViewById<TextView>(R.id.active_context)?.apply {
            val selected = graph.demo.current
            text = selected?.let { "${it.vehicleLabel} · ${it.userLabel}" }.orEmpty()
            visibility = if (selected == null) android.view.View.GONE else android.view.View.VISIBLE
        }
    }

    private fun updateUpload() {
        findViewById<TextView>(R.id.upload_status)?.text = graph.upload.status
        findViewById<Button>(R.id.save_observation)?.isEnabled =
            !graph.upload.busy &&
                (distanceState as? DistanceState.Finished)?.result is DistanceResult.Available
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("selected_destination", selected.name)
        outState.putInt("scroll_y", findViewById<ScrollView>(R.id.content_scroll).scrollY)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Legacy back callback for this API 34 prototype")
    override fun onBackPressed() {
        if (selected != Destination.VEHICLE) navigate(Destination.VEHICLE)
        else super.onBackPressed()
    }
}
