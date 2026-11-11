import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/connection.js";
import type { Principal } from "../identity/Authorization.js";
import {
  lockPersonalSession,
  type SessionRow,
} from "../personalization/session-access.js";
import { requireCondition } from "../shared/errors.js";
import { planComfort } from "./ComfortMigrationPlanner.js";
import {
  comfortScope,
  type ComfortKey,
  type ComfortValues,
  type ComfortCapability,
  type ComfortView,
  type ComfortStore,
  type ComfortItem,
  type PassengerPreset,
} from "./contracts.js";

/** 개인 계정 버전은 전역 선호와 차량별 override의 동시 저장·미리보기 만료를 함께 조정한다. */
export class PostgresComfortStore implements ComfortStore {
  constructor(private readonly pool: Pool) {}
  private scoped(values: ComfortValues, row: SessionRow): ComfortValues {
    return Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        row.scopes.includes(comfortScope(key as ComfortKey)),
      ),
    );
  }
  // 차량 먼저, 그다음 개인 세션·계정 잠금. 순서 제각각 잡으면 좌석 변경이나 프리셋 처리 때 교착 나기 쉬움. _ma
  private withSession<T>(
    actor: Principal,
    token: string,
    now: Date,
    action: (client: PoolClient, row: SessionRow) => Promise<T>,
  ) {
    return transaction(this.pool, async (c) => {
      // 좌석 배정과 동일한 잠금 순서. 프리셋 소비 중 운전자/좌석 변경과 경합하지 않는다.
      await c.query(
        "SELECT 1 FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
        [actor.vehicleRef],
      );
      return action(c, await lockPersonalSession(c, actor, token, now));
    });
  }
  private async capability(
    c: PoolClient,
    actor: Principal,
  ): Promise<ComfortCapability | null> {
    if (actor.environment !== "simulation") return null;
    return (
      (
        await c.query(
          "SELECT capability FROM personal.comfort_capability WHERE vehicle_ref=$1",
          [actor.vehicleRef],
        )
      ).rows[0]?.capability ?? null
    );
  }
  private async view(
    c: PoolClient,
    actor: Principal,
    row: SessionRow,
  ): Promise<ComfortView> {
    const capability = await this.capability(c, actor);
    const saved = row.seat
      ? (
          await c.query(
            "SELECT values,applied FROM personal.vehicle_comfort WHERE account_id=$1 AND vehicle_ref=$2 AND seat=$3",
            [row.account_id, row.vehicle_ref, row.seat],
          )
        ).rows[0]
      : null;
    const portable = this.scoped(
      {
        temperature: row.profile.climate,
        fanPercent: 60,
        seatPositionPercent: 50,
        seatHeating: 2,
        seatVentilation: 2,
        ...row.profile.comfort,
      },
      row,
    );
    const vehicleValues = this.scoped(saved?.values ?? {}, row);
    return {
      revision: row.profile_revision,
      seat: row.seat,
      capability,
      portable,
      vehicleValues,
      items: planComfort(capability, row.seat, portable, vehicleValues),
      lastApplied: (saved?.applied ?? []).filter((i: ComfortItem) =>
        row.scopes.includes(comfortScope(i.key)),
      ),
      notice:
        "합성 차량의 지원 범위에 맞춘 규칙 기반 맞춤 · 실제 차량 제어 아님",
    };
  }
  private allow(row: SessionRow, values: ComfortValues, revision: number) {
    requireCondition(
      row.profile_revision === revision,
      412,
      "profile_revision_changed",
    );
    requireCondition(
      Object.keys(values).every((k) =>
        row.scopes.includes(comfortScope(k as ComfortKey)),
      ),
      403,
      "scope_not_approved",
    );
  }
  private async bump(c: PoolClient, row: SessionRow) {
    await c.query(
      "UPDATE personal.account SET revision=revision+1 WHERE account_id=$1",
      [row.account_id],
    );
    row.profile_revision++;
  }
  private async saveVehicle(
    c: PoolClient,
    row: SessionRow,
    values: ComfortValues,
  ) {
    requireCondition(row.seat, 422, "seat_required");
    await c.query(
      "INSERT INTO personal.vehicle_comfort(account_id,vehicle_ref,seat,values) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,vehicle_ref,seat) DO UPDATE SET values=personal.vehicle_comfort.values || EXCLUDED.values",
      [row.account_id, row.vehicle_ref, row.seat, values],
    );
    await this.bump(c, row);
  }
  read(actor: Principal, token: string, now: Date) {
    return this.withSession(actor, token, now, (c, row) =>
      this.view(c, actor, row),
    );
  }
  // account는 공통 선호, vehicle은 계정·차량·좌석별 예외값. 둘 다 계정 버전 올려서 옛 미리보기 못 쓰게 함. _ma
  save(
    actor: Principal,
    token: string,
    revision: number,
    target: "account" | "vehicle",
    values: ComfortValues,
    now: Date,
  ) {
    return this.withSession(actor, token, now, async (c, row) => {
      this.allow(row, values, revision);
      if (target === "vehicle") await this.saveVehicle(c, row, values);
      else {
        row.profile = {
          ...row.profile,
          comfort: { ...row.profile.comfort, ...values },
        };
        // 기존 공조 선호 편집과 단일 원본을 공유한다.
        if (values.temperature !== undefined)
          row.profile.climate = values.temperature;
        await c.query(
          "UPDATE personal.account SET profile=$2 WHERE account_id=$1",
          [row.account_id, row.profile],
        );
        await this.bump(c, row);
      }
      return this.view(c, actor, row);
    });
  }
  resetVehicle(actor: Principal, token: string, revision: number, now: Date) {
    return this.withSession(actor, token, now, async (c, row) => {
      this.allow(row, {}, revision);
      requireCondition(row.seat, 422, "seat_required");
      // 해제된 범위의 저장 값은 건드리지 않는다.
      const view = await this.view(c, actor, row);
      await c.query(
        "UPDATE personal.vehicle_comfort SET values=values-$4::text[] WHERE account_id=$1 AND vehicle_ref=$2 AND seat=$3",
        [
          row.account_id,
          row.vehicle_ref,
          row.seat,
          Object.keys(view.vehicleValues),
        ],
      );
      await this.bump(c, row);
      return this.view(c, actor, row);
    });
  }
  preview(actor: Principal, token: string, now: Date) {
    return this.withSession(actor, token, now, async (c, row) => {
      const view = await this.view(c, actor, row);
      const id = randomUUID(),
        expiresAt = new Date(now.getTime() + 60000).toISOString();
      await c.query(
        "DELETE FROM personal.comfort_preview WHERE session_id=$1",
        [row.session_id],
      );
      await c.query(
        "INSERT INTO personal.comfort_preview VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL)",
        [
          id,
          row.session_id,
          row.revision,
          row.profile_revision,
          view.capability?.version ?? "unavailable",
          expiresAt,
          JSON.stringify(view.items),
        ],
      );
      return {
        id,
        expiresAt,
        vehicleName: view.capability?.name ?? "지원 범위 미확인",
        items: view.items,
      };
    });
  }
  // 세션·계정·차종 지원 버전 확인하고 되는 항목만 모의 결과로 저장. 실제 공조·시트 SDK 호출 아님. _ma
  apply(actor: Principal, token: string, id: string, now: Date) {
    return this.withSession(actor, token, now, async (c, row) => {
      const p = (
        await c.query(
          "SELECT * FROM personal.comfort_preview WHERE preview_id=$1 AND session_id=$2 FOR UPDATE",
          [id, row.session_id],
        )
      ).rows[0];
      requireCondition(p, 404, "preview_not_found");
      const capability = await this.capability(c, actor);
      requireCondition(
        p.session_revision === row.revision &&
          p.profile_revision === row.profile_revision &&
          p.capability_version === (capability?.version ?? "unavailable"),
        412,
        "preview_changed",
      );
      if (p.result) return p.result as ComfortItem[];
      requireCondition(p.expires_at > now, 412, "preview_expired");
      requireCondition(
        capability && row.seat,
        422,
        "comfort_application_unavailable",
      );
      const result = (p.items as ComfortItem[]).filter(
        (i) => i.disposition === "unchanged" || i.disposition === "adjusted",
      );
      requireCondition(result.length, 422, "no_supported_preferences");
      await c.query(
        "INSERT INTO personal.vehicle_comfort(account_id,vehicle_ref,seat,applied) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,vehicle_ref,seat) DO UPDATE SET applied=EXCLUDED.applied",
        [row.account_id, row.vehicle_ref, row.seat, JSON.stringify(result)],
      );
      await c.query(
        "UPDATE personal.comfort_preview SET result=$2,confirmed_at=$3 WHERE preview_id=$1",
        [id, JSON.stringify(result), now],
      );
      return result;
    });
  }
  presets(actor: Principal, token: string, now: Date) {
    return this.withSession(actor, token, now, async (c, row) => {
      const rows = (
        await c.query(
          `SELECT p.preset_id AS id,p.name,a.display_name AS "ownerName",p.values FROM personal.passenger_preset p JOIN personal.account a ON a.account_id=p.owner_account_id WHERE p.owner_account_id=$1 OR EXISTS(SELECT 1 FROM personal.session s WHERE s.account_id=p.owner_account_id AND s.vehicle_ref=$2 AND s.principal_id=$3 AND s.seat='driver' AND s.ended_at IS NULL AND s.expires_at>$4) ORDER BY p.name LIMIT 20`,
          [row.account_id, row.vehicle_ref, actor.id, now],
        )
      ).rows;
      return rows.map((p) => ({
        ...p,
        values: this.scoped(p.values, row),
      })) as PassengerPreset[];
    });
  }
  savePreset(
    actor: Principal,
    token: string,
    name: string,
    values: ComfortValues,
    now: Date,
  ) {
    return this.withSession(actor, token, now, async (c, row) => {
      requireCondition(row.seat === "driver", 403, "driver_required");
      this.allow(row, values, row.profile_revision);
      requireCondition(name.trim().length > 0, 422, "preset_name_required");
      const count = Number(
        (
          await c.query(
            "SELECT count(*) FROM personal.passenger_preset WHERE owner_account_id=$1",
            [row.account_id],
          )
        ).rows[0].count,
      );
      const exists = (
        await c.query(
          "SELECT 1 FROM personal.passenger_preset WHERE owner_account_id=$1 AND name=$2",
          [row.account_id, name.trim()],
        )
      ).rowCount;
      requireCondition(count < 10 || exists, 409, "preset_limit");
      const saved = (
        await c.query(
          `INSERT INTO personal.passenger_preset VALUES($1,$2,$3,$4) ON CONFLICT(owner_account_id,name) DO UPDATE SET values=EXCLUDED.values RETURNING preset_id AS id,name,values`,
          [randomUUID(), row.account_id, name.trim(), values],
        )
      ).rows[0];
      return { ...saved, ownerName: row.display_name } as PassengerPreset;
    });
  }
  // 같은 차에 유효한 운전자 세션 있는 프리셋만 가져옴. 동승자가 동의한 값만 현재 좌석에 저장. 적용은 따로. _ma
  loadPreset(
    actor: Principal,
    token: string,
    id: string,
    revision: number,
    now: Date,
  ) {
    return this.withSession(actor, token, now, async (c, row) => {
      requireCondition(
        row.seat && row.seat !== "driver",
        403,
        "passenger_required",
      );
      const preset = (
        await c.query(
          `SELECT p.values FROM personal.passenger_preset p JOIN personal.session s ON s.account_id=p.owner_account_id WHERE p.preset_id=$1 AND s.vehicle_ref=$2 AND s.principal_id=$3 AND s.seat='driver' AND s.ended_at IS NULL AND s.expires_at>$4 FOR SHARE OF p,s`,
          [id, row.vehicle_ref, actor.id, now],
        )
      ).rows[0];
      requireCondition(preset, 404, "preset_unavailable");
      const values = this.scoped(preset.values, row);
      requireCondition(Object.keys(values).length, 403, "scope_not_approved");
      this.allow(row, values, revision);
      await this.saveVehicle(c, row, values);
      return this.view(c, actor, row);
    });
  }
}
