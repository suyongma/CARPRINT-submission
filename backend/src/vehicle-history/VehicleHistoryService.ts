import { authorize, type Principal } from "../identity/Authorization.js";
import { requireCondition } from "../shared/errors.js";
import type {
  EventRequest,
  VehicleEventStore,
  VehicleHistoryReader,
  CorrectionInput,
} from "./contracts.js";
export class VehicleHistoryService {
  constructor(
    private readonly store: VehicleEventStore,
    private readonly reader: VehicleHistoryReader,
    private readonly clock: () => Date,
  ) {}
  // 정정은 여기로 넣지 말 것. 원본이랑 최신본 확인하는 correct로 보내야 함. _ma
  ingest(principal: Principal, body: EventRequest, key: string) {
    requireCondition(
      body.event_type !== "maintenance.corrected",
      422,
      "correction_endpoint_required",
    );
    this.validateSourceScope(principal, body);
    return this.store.append(principal, body, key, this.clock());
  }
  correct(principal: Principal, input: CorrectionInput, key: string) {
    authorize(principal, "events:correct:own");
    this.validateSourceScope(principal, input.replacement);
    requireCondition(
      input.replacement.event_type === "maintenance.corrected",
      422,
      "replacement_type_required",
    );
    return this.store.append(
      principal,
      input.replacement,
      key,
      this.clock(),
      input,
    );
  }
  timeline(
    principal: Principal,
    vehicle: string,
    cursor?: string,
    limit?: number,
  ) {
    authorize(principal, "timeline:read", vehicle);
    return this.reader.timeline(principal, cursor, limit);
  }
  // 이벤트 종류 보고 권한·환경·수집 범위 확인함. 클라이언트가 써 보낸 범위를 그냥 믿진 않음. _ma
  private validateSourceScope(principal: Principal, body: EventRequest) {
    const scope = body.event_type.startsWith("odometer")
      ? "odometer"
      : body.event_type.startsWith("warning")
        ? "warnings"
        : "maintenance";
    authorize(principal, `events:append:${scope}`);
    requireCondition(
      body.environment === principal.environment &&
        body.collection_scope.length === 1 &&
        body.collection_scope[0] === scope,
      403,
      "source_scope_forbidden",
    );
  }
}
