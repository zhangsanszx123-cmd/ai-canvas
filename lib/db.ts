import "server-only";

import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { checkServerIdentity } from "node:tls";

const globalForDb = globalThis as typeof globalThis & {
  databasePool?: Pool;
};

function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("请在 .env 中配置 DATABASE_URL");
  }

  const url = new URL(connectionString);
  const caPath = process.env.DB_CA_CERT;
  const tlsServerName = process.env.DB_TLS_SERVERNAME;
  if (caPath) {
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      url.searchParams.delete(key);
  }
  const pool = new Pool({
    connectionString: url.toString(),
    ...(caPath
      ? {
          ssl: {
            ca: readFileSync(caPath, "utf8"),
            rejectUnauthorized: true,
            ...(tlsServerName
              ? {
                  checkServerIdentity: (
                    _host: string,
                    cert: Parameters<typeof checkServerIdentity>[1],
                  ) => checkServerIdentity(tlsServerName, cert),
                }
              : {}),
          },
        }
      : {}),
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // Idle connections can fail after network interruptions. Avoid logging credentials.
  pool.on("error", () => {
    console.error("数据库空闲连接异常，将在后续查询时重新连接。");
  });

  return pool;
}

/** Server Components, Server Actions and Node.js Route Handlers only. */
export function getDb(): Pool {
  globalForDb.databasePool ??= createPool();
  return globalForDb.databasePool;
}
