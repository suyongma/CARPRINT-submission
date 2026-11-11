export interface AppConfig {
  databaseUrl: string;
  publicOrigin: string;
  cacheKey: Buffer;
  cursorKey: Buffer;
  receiptKeyPath: string;
  port: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing configuration: ${name}`);
    return value;
  };
  const key = (name: string) => {
    const value = required(name);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid key: ${name}`);
    return Buffer.from(value, "hex");
  };
  const publicOrigin = new URL(required("PUBLIC_ORIGIN"));
  if (
    publicOrigin.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(publicOrigin.hostname)
  ) {
    throw new Error("Non-loopback sharing requires HTTPS");
  }
  return {
    databaseUrl: required("DATABASE_URL"),
    publicOrigin: publicOrigin.origin,
    cacheKey: key("CACHE_KEY_HEX"),
    cursorKey: key("CURSOR_KEY_HEX"),
    receiptKeyPath: required("RECEIPT_KEY_PATH"),
    port: Number(env.PORT ?? "18080"),
  };
}
