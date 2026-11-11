package com.maandlee.carprint.personalscore

import org.json.JSONObject

data class ScoreDimension(val score: Int, val count: Int, val state: String)

/** 승인된 계정의 읽기 전용 요약. 디스크에 저장하거나 차량 설정 적용/리포트에 넣지 않는다. */
data class PersonalScore(
    val score: Int,
    val state: String,
    val driving: ScoreDimension,
    val care: ScoreDimension,
    val excludedCount: Int,
    val firstEvidenceAt: String?,
    val lastEvidenceAt: String?,
    val ruleVersion: String,
    val notice: String,
)

internal fun personalScoreFromJson(value: JSONObject): PersonalScore {
    fun dimension(key: String) =
        value.getJSONObject(key).run {
            ScoreDimension(getInt("score"), getInt("evidenceCount"), getString("state"))
        }
    return value.run {
        PersonalScore(
            getInt("score"),
            getString("state"),
            dimension("driving"),
            dimension("care"),
            getInt("excludedCount"),
            if (isNull("firstEvidenceAt")) null else getString("firstEvidenceAt"),
            if (isNull("lastEvidenceAt")) null else getString("lastEvidenceAt"),
            getString("ruleVersion"),
            getString("notice"),
        )
    }
}
