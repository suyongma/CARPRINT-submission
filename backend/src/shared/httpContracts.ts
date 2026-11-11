import type { Principal } from "../identity/Authorization.js";
import { requireCondition } from "./errors.js";
export type Authenticate = (authorizationHeader?: string) => Promise<Principal>;
export const uuid = { type: "string", format: "uuid" };
export const params = (name: string) => ({
  type: "object",
  properties: { [name]: uuid },
  required: [name],
  additionalProperties: false,
});
export function idempotency(header: unknown): string {
  requireCondition(
    typeof header === "string" && /^[A-Za-z0-9:_.-]{1,128}$/.test(header),
    422,
    "idempotency_key_required",
  );
  return header;
}
