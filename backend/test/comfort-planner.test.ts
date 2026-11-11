import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planComfort } from "../src/comfort/ComfortMigrationPlanner.js";
const caps = JSON.parse(
  readFileSync("../fixtures/demo/comfort-capabilities.json", "utf8"),
);
test("comfort planner: manual seat, shared HVAC, missing capability and quantization", () => {
  const b = caps["demo-vehicle-b"];
  const items = planComfort(
    b,
    "front_passenger",
    { temperature: 22.5, seatPositionPercent: 50, seatVentilation: 2 },
    {},
  );
  assert.equal(items[0]!.target, 23);
  assert.equal(items[1]!.disposition, "unsupported");
  assert.equal(items[2]!.target, null);
  assert.equal(
    planComfort(b, "second_left", { temperature: 22 }, {})[0]!.disposition,
    "unsupported",
  );
  assert.equal(
    planComfort(b, null, { temperature: 22 }, {})[0]!.disposition,
    "blocked",
  );
  assert.equal(
    planComfort(null, "driver", { temperature: 22 }, {})[0]!.target,
    null,
  );
});
