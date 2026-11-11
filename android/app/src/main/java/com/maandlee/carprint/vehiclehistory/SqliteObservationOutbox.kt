package com.maandlee.carprint.vehiclehistory

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.maandlee.carprint.connection.DeviceVault

/** SQLite에는 전송 본문을 AES-GCM 암호문으로 저장. 모든 상태 변경은 동일 행에 적용한다. */
class SqliteObservationOutbox(
    context: Context,
    private val vault: DeviceVault,
    private val capacity: Int = 500,
    name: String = "observations.db",
) : SQLiteOpenHelper(context, name, null, 2), ObservationOutbox {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE observation(id TEXT PRIMARY KEY, observation_key TEXT UNIQUE NOT NULL, vehicle_ref TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '')"
        )
        db.execSQL(
            "CREATE TABLE queue_pressure(id INTEGER PRIMARY KEY, vehicle_ref TEXT UNIQUE, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, count INTEGER NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE queue_pressure ADD COLUMN vehicle_ref TEXT")
            db.execSQL("CREATE UNIQUE INDEX queue_pressure_vehicle ON queue_pressure(vehicle_ref)")
        }
    }

    @Synchronized
    // 중복·용량 확인하고 암호화 본문 넣는 것까지 한 트랜잭션. 같은 관측 또 넣으면 기존 ID 줌. _ma
    override fun enqueue(
        observationKey: String,
        eventId: String,
        vehicleRef: String,
        body: String,
    ): String {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery(
                    "SELECT id FROM observation WHERE observation_key=?",
                    arrayOf(observationKey),
                )
                .use {
                    if (it.moveToFirst()) {
                        db.setTransactionSuccessful()
                        return it.getString(0)
                    }
                }
            val count =
                db.rawQuery("SELECT count(*) FROM observation WHERE state<>'acknowledged'", null)
                    .use {
                        it.moveToFirst()
                        it.getInt(0)
                    }
            if (count >= capacity) {
                val now = System.currentTimeMillis()
                db.execSQL(
                    "INSERT INTO queue_pressure(vehicle_ref,first_at,last_at,count) VALUES(?,?,?,1) ON CONFLICT(vehicle_ref) DO UPDATE SET last_at=excluded.last_at,count=count+1",
                    arrayOf<Any>(vehicleRef, now, now),
                )
                db.setTransactionSuccessful()
                // 한도 초과 횟수는 성공 표시해서 커밋함. 호출은 실패여도 미전송 가능 구간 흔적은 남겨야 함. _ma
                throw OutboxFull()
            }
            db.insertOrThrow(
                "observation",
                null,
                ContentValues().apply {
                    put("id", eventId)
                    put("observation_key", observationKey)
                    put("vehicle_ref", vehicleRef)
                    put("body", vault.encrypt(body))
                    put("state", "queued")
                },
            )
            db.setTransactionSuccessful()
            return eventId
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    // 재시도 시각 된 현재 차량 건 중 실패 5회 미만만 최대 20개 읽음. 타이머 아님. 호출할 때만 조회. _ma
    override fun ready(vehicleRef: String, now: Long): List<PendingObservation> =
        readableDatabase
            .rawQuery(
                "SELECT id,body,attempts FROM observation WHERE vehicle_ref=? AND state IN ('queued','retry_waiting') AND next_at<=? AND attempts<5 ORDER BY rowid LIMIT 20",
                arrayOf(vehicleRef, now.toString()),
            )
            .use { cursor ->
                buildList {
                    while (cursor.moveToNext()) add(
                        PendingObservation(
                            cursor.getString(0),
                            vault.decrypt(cursor.getString(1)),
                            cursor.getInt(2),
                        )
                    )
                }
            }

    @Synchronized
    override fun acknowledged(id: String, receipt: IngestReceipt) {
        writableDatabase.execSQL(
            "UPDATE observation SET state='acknowledged',message=? WHERE id=?",
            arrayOf("서버 저장 #${receipt.sequence} · ${receipt.receivedAt}", id),
        )
    }

    @Synchronized
    // 일시 오류면 다음 시도 늦추고 못 재시도하는 건 blocked. 원래 본문·ID는 안 지움. _ma
    override fun failed(id: String, retryable: Boolean, reason: String, now: Long) {
        writableDatabase.execSQL(
            "UPDATE observation SET state=?, attempts=attempts+1,next_at=? + MIN(300000,5000 * (1 << attempts)),message=? WHERE id=?",
            arrayOf<Any>(if (retryable) "retry_waiting" else "blocked", now, reason, id),
        )
    }

    @Synchronized
    override fun resumeRetries(vehicleRef: String) {
        writableDatabase.execSQL(
            "UPDATE observation SET state='queued',attempts=0,next_at=0 WHERE vehicle_ref=? AND (state='retry_waiting' OR (state='blocked' AND message IN ('authentication_required','scope_or_vehicle_forbidden')))",
            arrayOf(vehicleRef),
        )
    }

    @Synchronized
    override fun summary(vehicleRef: String): String {
        val counts = mutableMapOf<String, Int>()
        readableDatabase
            .rawQuery(
                "SELECT state,count(*) FROM observation WHERE vehicle_ref=? GROUP BY state",
                arrayOf(vehicleRef),
            )
            .use { while (it.moveToNext()) counts[it.getString(0)] = it.getInt(1) }
        val last =
            readableDatabase
                .rawQuery(
                    "SELECT message FROM observation WHERE state='acknowledged' AND vehicle_ref=? ORDER BY rowid DESC LIMIT 1",
                    arrayOf(vehicleRef),
                )
                .use { if (it.moveToFirst()) it.getString(0) else "서버 저장 기록 없음" }
        val pressure =
            readableDatabase
                .rawQuery(
                    "SELECT first_at,last_at,count FROM queue_pressure WHERE vehicle_ref=? OR vehicle_ref IS NULL",
                    arrayOf(vehicleRef),
                )
                .use {
                    if (it.moveToFirst())
                        "\n대기열 한도 초과 ${it.getInt(2)}회 · ${java.time.Instant.ofEpochMilli(it.getLong(0))} ~ ${java.time.Instant.ofEpochMilli(it.getLong(1))} · 이 구간 미전송 가능"
                    else ""
                }
        val exhausted =
            readableDatabase
                .rawQuery(
                    "SELECT count(*) FROM observation WHERE state='retry_waiting' AND attempts>=5 AND vehicle_ref=?",
                    arrayOf(vehicleRef),
                )
                .use {
                    it.moveToFirst()
                    it.getInt(0)
                }
        return "$last\n전송 대기 ${(counts["queued"] ?: 0) + (counts["retry_waiting"] ?: 0)}건 · 확인 필요 ${(counts["blocked"] ?: 0) + exhausted}건$pressure"
    }
}
