import canonicalize from "canonicalize";
import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";

// RFC 8785 라이브러리 사용. JSON 숫자의 비정상 값은 schema/업무 입력에서 거부한다.
export function canonical(value: unknown): string {
  return canonicalize(value)!;
}
export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function digest(value: unknown): string {
  return hash(canonical(value));
}
export function secret(): string {
  return randomBytes(32).toString("base64url");
}
export function equalHash(left: string, right: string): boolean {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
/** 짧은 멱등 응답만 암호화한다. 공유 테이블에는 원문 대신 해시만 둔다. */
export class ResponseCipher {
  constructor(private readonly key: Buffer) {}
  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  open<T>(encoded: string): T {
    const bytes = Buffer.from(encoded, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      bytes.subarray(0, 12),
    );
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  }
}
export class CursorCodec {
  constructor(private readonly key: Buffer) {}
  encode(value: unknown): string {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${body}.${createHmac("sha256", this.key).update(body).digest("hex")}`;
  }
  decode<T>(token: string): T {
    const [body, signature] = token.split(".");
    if (
      !body ||
      !signature ||
      !equalHash(
        signature,
        createHmac("sha256", this.key).update(body).digest("hex"),
      )
    )
      throw new Error("Invalid cursor");
    return JSON.parse(Buffer.from(body, "base64url").toString());
  }
}
