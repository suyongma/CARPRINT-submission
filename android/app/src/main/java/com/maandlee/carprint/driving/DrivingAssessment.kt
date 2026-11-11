package com.maandlee.carprint.driving

/** 서버 계산 결과. candidateScore와 개인 원장 반영 가능 여부를 구분한다. */
data class DrivingAssessment(
    val ruleVersion: String,
    val source: String,
    val scoreEligible: Boolean,
    val candidateScore: Int?,
    val durationSeconds: Double,
    val distanceKm: Double,
    val harshDecelerationCandidates: Int,
    val harshAccelerationCandidates: Int,
    val reasons: List<String>,
    val notice: String,
)
