import {
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { canonical, hash } from "../shared/crypto.js";
import type { Receipt, ReceiptSigner } from "./contracts.js";
export class Ed25519ReceiptSigner implements ReceiptSigner {
  readonly keyId: string;
  private readonly key: KeyObject;
  constructor(pem: string) {
    this.key = createPrivateKey(pem);
    this.keyId = hash(
      createPublicKey(this.key)
        .export({ type: "spki", format: "pem" })
        .toString(),
    ).slice(0, 16);
  }
  sign(body: Omit<Receipt, "signature">): string {
    return sign(null, Buffer.from(canonical(body)), this.key).toString(
      "base64url",
    );
  }
}
