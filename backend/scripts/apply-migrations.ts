import { readFileSync, readdirSync } from "node:fs";
import type { Pool } from "pg";
import { transaction } from "../src/db/connection.js";

/** 대상 선택·자격 생성은 호출자가 책임진다. SQL 전체를 잠금과 단일 트랜잭션으로 적용한다. */
// 번호순으로 안 돌린 SQL만 실행함. 옛 파일 고쳐봤자 다시 안 돎. 구조 바꾸려면 새 번호 추가. _ma
export async function applyMigrations(pool: Pool): Promise<void> {
  await transaction(pool, async (client) => {
    // 동시에 migration 돌리지 말라고 거는 advisory lock. 커밋·롤백하면 알아서 풀림. _ma
    await client.query("SELECT pg_advisory_xact_lock(7035207)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.schema_migration (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    const directory = new URL("../src/db/migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort()) {
      const version = file.slice(0, 3);
      if (
        (
          await client.query(
            "SELECT 1 FROM public.schema_migration WHERE version=$1",
            [version],
          )
        ).rowCount
      )
        continue;
      await client.query(readFileSync(new URL(file, directory), "utf8"));
      await client.query(
        "INSERT INTO public.schema_migration(version) VALUES($1)",
        [version],
      );
    }
  });
}
