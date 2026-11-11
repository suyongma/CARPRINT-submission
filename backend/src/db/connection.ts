import { Pool, type PoolClient } from "pg";
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 6,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
/** 호출자가 정한 업무 단위를 커밋한다. 자동 재시도는 부작용 계약 없이 수행하지 않는다. */
// SQL은 전부 이 client로 실행해야 같이 커밋됨. 실패하면 롤백하고 예외 넘김. 연결 반납은 finally. _ma
export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
