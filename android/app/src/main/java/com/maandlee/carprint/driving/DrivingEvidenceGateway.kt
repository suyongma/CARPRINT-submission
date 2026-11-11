package com.maandlee.carprint.driving

import com.maandlee.carprint.connection.*
import org.json.JSONArray
import org.json.JSONObject

interface DrivingEvidenceGateway {
    fun begin(connection: BackendConnection): String

    /** ID와 표본이 같으면 재시도 안전. 서버가 계산하며 개인정보/희망 점수를 보내지 않는다. */
    fun finish(
        connection: BackendConnection,
        id: String,
        samples: List<SpeedSample>,
    ): DrivingAssessment
}

class HttpDrivingEvidenceGateway(private val transport: HttpTransport) : DrivingEvidenceGateway {
    override fun begin(connection: BackendConnection) =
        transport
            .request(
                connection.baseUrl,
                "/v1/driving-observations",
                connection.collectorToken,
                "POST",
                "{}",
            )
            .getString("observationId")

    override fun finish(connection: BackendConnection, id: String, samples: List<SpeedSample>) =
        transport
            .request(
                connection.baseUrl,
                "/v1/driving-observations/$id",
                connection.collectorToken,
                "PUT",
                JSONObject()
                    .put(
                        "samples",
                        JSONArray(
                            samples.map {
                                JSONObject()
                                    .put("elapsedMs", it.elapsedMs)
                                    .put("metersPerSecond", it.metersPerSecond)
                            }
                        ),
                    )
                    .toString(),
            )
            .run {
                val reasons = getJSONArray("reasons")
                DrivingAssessment(
                    getString("ruleVersion"),
                    getString("source"),
                    getBoolean("scoreEligible"),
                    if (isNull("candidateScore")) null else getInt("candidateScore"),
                    getDouble("durationSeconds"),
                    getDouble("distanceKm"),
                    getInt("harshDecelerationCandidates"),
                    getInt("harshAccelerationCandidates"),
                    (0 until reasons.length()).map(reasons::getString),
                    getString("notice"),
                )
            }
}
