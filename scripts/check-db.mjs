import { getDb } from "../lib/db.ts";

const db = getDb();

try {
  await db.query("SELECT 1");
  console.log("数据库连接成功。");
} catch (error) {
  console.error("数据库连接失败，请检查 DATABASE_URL 和数据库网络访问配置。", {
    code: error.code ?? "UNKNOWN",
  });
  process.exitCode = 1;
} finally {
  await db.end();
}
