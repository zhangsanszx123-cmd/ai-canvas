import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/auth";
import { getDb } from "../lib/db";

async function main() {
  const pool = getDb();
  try {
    const plan = await getMigrations(auth.options);
    if (plan.unsafeChanges.length || plan.schemaProblems.length)
      throw new Error("认证表结构存在冲突，请先审阅迁移计划");
    const sql = await plan.compileMigrations();
    if (
      plan.toBeCreated.length ||
      plan.toBeAdded.length ||
      plan.toBeAddedIndexes.length
    ) {
      const target = existsSync("db/migrations/000-auth.generated.sql")
        ? `db/migrations/000-auth-${Date.now()}.generated.sql`
        : "db/migrations/000-auth.generated.sql";
      await writeFile(target, sql, "utf8");
      await plan.runMigrations();
      console.log("认证表迁移完成");
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('ai-canvas-migrations'))",
      );
      await db.query(
        "CREATE TABLE IF NOT EXISTS ac_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const name of (await readdir("db/migrations"))
        .filter((n) => n.endsWith(".sql") && !n.startsWith("000-"))
        .sort()) {
        if (
          (await db.query("SELECT 1 FROM ac_migrations WHERE name=$1", [name]))
            .rowCount
        )
          continue;
        await db.query(await readFile(`db/migrations/${name}`, "utf8"));
        await db.query("INSERT INTO ac_migrations(name) VALUES($1)", [name]);
        console.log(`迁移完成：${name}`);
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    console.error(
      "迁移失败：",
      e instanceof Error
        ? e.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]")
        : "未知错误",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
void main();
