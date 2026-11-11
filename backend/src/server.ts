import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { createPool } from "./db/connection.js";
// 설정 읽고 DB 풀 만들고 API 붙임. 그다음 요청 받으면 됨. _ma
const config = readConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp(config, pool);
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`CARPRINT local API: ${config.publicOrigin}`);
// 종료할 땐 HTTP부터 닫고 DB 풀 닫음. 여기서 열었으니 여기서 정리. _ma
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
