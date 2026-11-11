/** 실제 개인정보 없이 임시 계정·평가 예제를 준비한다. 기존 프로필/이력은 덮어쓰지 않는다. */
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { createPool, transaction } from "../src/db/connection.js";
export async function seedExperience(pool: Pool) {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../fixtures/stages-5-7/seed-bundle.json", import.meta.url),
      "utf8",
    ),
  );
  const vehicleA = fixture.alias_to_uuid["demo-vehicle-a"],
    vehicleB = fixture.alias_to_uuid["demo-vehicle-b"];
  await transaction(pool, async (client) => {
    const comfortCapabilities = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/demo/comfort-capabilities.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const [alias, capability] of Object.entries(comfortCapabilities)) {
      await client.query(
        "INSERT INTO personal.comfort_capability VALUES($1,$2) ON CONFLICT DO NOTHING",
        [fixture.alias_to_uuid[alias], capability],
      );
    }

    for (const [account, name, climate, volume] of [
      ["demo-a", "임시 계정 A", 22, 8],
      ["demo-b", "임시 계정 B", 24, 12],
    ] as const) {
      const profile = {
        climate,
        volume,
        destination: account === "demo-a" ? "합성 공원" : "합성 도서관",
        seat: {
          [vehicleA]: account === "demo-a" ? 35 : 45,
          [vehicleB]: account === "demo-a" ? 60 : 55,
        },
      };
      await client.query(
        "INSERT INTO personal.account(account_id,display_name,profile) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [account, name, profile],
      );
    }
    const scoreFixture = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/personal-score/account-history.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const entry of scoreFixture.observations) {
      await client.query(
        "INSERT INTO personal.score_observation(observation_id,account_id,vehicle_ref,category,responsibility) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          entry.observationId,
          entry.accountId,
          fixture.alias_to_uuid[entry.vehicleAlias],
          entry.category,
          entry.responsibility,
        ],
      );
      await client.query(
        "INSERT INTO personal.score_revision(observation_id,revision,occurred_at,recorded_at,source,attribution_confirmed,metrics) VALUES($1,1,$2,$2,'simulation',true,$3) ON CONFLICT DO NOTHING",
        [entry.observationId, entry.occurredAt, entry.metrics],
      );
    }
    for (const [vehicle, seats] of [
      [
        vehicleA,
        [
          "driver",
          "front_passenger",
          "second_left",
          "second_center",
          "second_right",
        ],
      ],
      [
        vehicleB,
        [
          "driver",
          "front_passenger",
          "second_left",
          "second_right",
          "third_left",
          "third_right",
        ],
      ],
    ]) {
      await client.query(
        "INSERT INTO personal.vehicle_layout VALUES($1,$2) ON CONFLICT DO NOTHING",
        [vehicle, seats],
      );
    }
    for (const id of [
      "care_95",
      "fresh_install",
      "coverage_gap",
      "evidence_revoked",
      "corrected_record",
      "preventive_only",
      "departure_attention",
    ]) {
      const input = JSON.parse(
        readFileSync(
          new URL(
            id === "departure_attention"
              ? `../../fixtures/stages-8-9/${id}.json`
              : `../../fixtures/demo/scenarios/${id}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO trust.care_example VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, input.label, input],
      );
    }
  });
}
if (process.argv[1]?.endsWith("seed-experience.ts")) {
  const url = new URL(process.env.OWNER_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/carprint_demo")
    throw new Error("Local demo only");
  const pool = createPool(url.toString());
  try {
    await seedExperience(pool);
    console.log(
      "Synthetic care examples and temporary accounts ready; existing records preserved.",
    );
  } finally {
    await pool.end();
  }
}
