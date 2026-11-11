import { authorize, type Principal } from "../identity/Authorization.js";
import { requireCondition } from "../shared/errors.js";
import type { ReportRequest, ReportStore } from "./contracts.js";
export class ReportService {
  constructor(
    private readonly store: ReportStore,
    private readonly clock: () => Date,
  ) {}
  // 권한이랑 기간부터 확인하고 서버 시각 넘김. 발급 자료 고정하고 공유 비밀 챙기는 건 저장소 쪽. _ma
  create(principal: Principal, request: ReportRequest, key: string) {
    authorize(principal, "reports:create", request.vehicle_ref);
    requireCondition(
      Date.parse(request.scope.from) <= Date.parse(request.scope.to),
      422,
      "invalid_period",
    );
    return this.store.create(principal, request, key, this.clock());
  }
  list(principal: Principal) {
    authorize(principal, "reports:read");
    return this.store.list(principal, this.clock());
  }
  status(principal: Principal, id: string) {
    authorize(principal, "reports:read");
    return this.store.status(principal, id, this.clock());
  }
  revoke(principal: Principal, id: string) {
    authorize(principal, "reports:revoke");
    return this.store.revoke(principal, id, this.clock());
  }
  exchange(id: string, secret: string) {
    return this.store.exchange(id, secret, this.clock());
  }
  view(id: string, session: string) {
    return this.store.view(id, session, this.clock());
  }
}
