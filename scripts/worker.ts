import { tick, cleanup } from "../lib/worker";
import { getDb } from "../lib/db";
async function main() {
  const lock = await getDb().connect();
  if (
    !(
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtext('ai-canvas-worker')) AS locked",
      )
    ).rows[0].locked
  ) {
    console.error("已有工作进程或集成测试正在运行");
    lock.release();
    await getDb().end();
    return;
  }
  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });
  process.on("SIGTERM", () => {
    running = false;
  });
  console.log("AI Canvas 生图工作进程已启动");
  let lastCleanup = 0;
  while (running) {
    try {
      const busy = await tick();
      if (Date.now() - lastCleanup > 3600000) {
        await cleanup();
        lastCleanup = Date.now();
      }
      if (!busy) await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (e) {
      console.error(
        "worker_unavailable",
        e instanceof Error ? e.name : "Error",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  await lock.query("SELECT pg_advisory_unlock(hashtext('ai-canvas-worker'))");
  lock.release();
  await getDb().end();
}
void main();
