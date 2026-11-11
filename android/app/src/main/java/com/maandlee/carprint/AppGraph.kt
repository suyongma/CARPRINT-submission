package com.maandlee.carprint

import android.content.Context
import com.maandlee.carprint.care.*
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.demo.DemoContextController
import com.maandlee.carprint.driving.*
import com.maandlee.carprint.personalization.*
import com.maandlee.carprint.reports.*
import com.maandlee.carprint.vehiclehistory.*

/** 실제 구현체는 이 조립 진입점에서만 선택. Activity 재생성 시 같은 기능 상태/작업을 유지한다. */
// HTTP·저장소·작업 큐는 여기서 만들어 넘김. 옛 Activity 붙잡지 않게 applicationContext 씀. _ma
class AppGraph(context: Context) {
    private val app = context.applicationContext
    private val contextId =
        app.getSharedPreferences("demo-context", Context.MODE_PRIVATE)
            .getString("selected", "a:a")!!
    private val vault = DeviceVault(app)
    private val connections =
        BackendConnectionStore(
            app,
            vault,
            if (app.packageName.endsWith(".pleos")) "pleos_emulator" else "simulation",
            contextId,
        )
    private val transport = HttpTransport()
    private val work = UiWorkScope()
    private val outbox = SqliteObservationOutbox(app, vault)
    private val historyGateway = HttpVehicleHistoryGateway(transport)
    var onChanged: () -> Unit = {}
    val setup =
        DemoSetupController(app, connections, HttpDemoSetupGateway(transport), work) {
            if (setupReady()) {
                demo.load()
                care.load()
                personal.load()
            }
            onChanged()
        }

    private fun setupReady(): Boolean = setup.configured

    val upload =
        ObservationUploadController(connections::load, historyGateway, outbox, work) { onChanged() }
    val history =
        VehicleHistoryController(connections::load, historyGateway, vault, work) { onChanged() }
    val reports =
        ReportController(
            connections::load,
            HttpReportGateway(transport),
            vault,
            work,
            "report:$contextId",
        ) {
            onChanged()
        }

    val care =
        CareAssessmentController(connections::load, HttpCareAssessmentGateway(transport), work) {
            onChanged()
        }
    val personal =
        PersonalizationController(
            connections::load,
            HttpPersonalizationGateway(transport),
            PersonalSessionJournal(vault, "personal:$contextId"),
            work,
            com.maandlee.carprint.comfort.HttpComfortGateway(transport),
        ) {
            onChanged()
        }
    val driving =
        DrivingEvidenceController(
            connections::load,
            { createDrivingSignalAdapter(app) },
            HttpDrivingEvidenceGateway(transport),
            work,
        ) {
            onChanged()
        }
    val demo = DemoContextController(app, connections, work, contextId) { onChanged() }

    init {
        setup.load()
    }

    // 관측이랑 개인 세션 정리 먼저 넣고 worker 마지막에 SQLite 닫음. DB부터 닫으면 남은 저장 작업 터짐. _ma
    fun close() {
        onChanged = {}
        driving.close()
        personal.close()
        work.close { outbox.close() }
    }
}
