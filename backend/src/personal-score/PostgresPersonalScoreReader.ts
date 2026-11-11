import type { Pool } from "pg";
import type {
  PersonalScoreEvidence,
  PersonalScoreReader,
} from "./contracts.js";
import { calculatePersonalScore } from "./PersonalScoreCalculator.js";

export class PostgresPersonalScoreReader implements PersonalScoreReader {
  constructor(private readonly pool: Pick<Pool, "query">) {}
  // accountId로 읽으니 차 바꿔도 기록 따라감. 관측마다 최신 정정/취소 하나만 계산기에 넘김. _ma
  async read(accountId: string, now: Date) {
    // 한 statement의 스냅샷에서 최신 정정/취소를 선택. 취소 이전 정상본으로 되돌리지 않는다.
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (o.observation_id) o.observation_id,o.category,r.*
       FROM personal.score_observation o JOIN personal.score_revision r USING(observation_id)
       WHERE o.account_id=$1 AND r.recorded_at<=$2
       ORDER BY o.observation_id,r.revision DESC`,
      [accountId, now],
    );
    const evidence: PersonalScoreEvidence[] = rows.map((row) => ({
      observationId: row.observation_id,
      category: row.category,
      occurredAt: row.occurred_at.toISOString(),
      attributionConfirmed: row.attribution_confirmed,
      revoked: row.revoked,
      source: row.source,
      metrics: row.metrics,
    }));
    return calculatePersonalScore(evidence, now);
  }
}
