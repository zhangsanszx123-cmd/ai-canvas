import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const next = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true },
);
const worker = spawn(
  process.execPath,
  [
    "--env-file=.env",
    "--conditions=react-server",
    "--import",
    "tsx",
    fileURLToPath(new URL("./worker.ts", import.meta.url)),
  ],
  { stdio: "inherit", windowsHide: true },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  next.kill();
  worker.kill();
  process.exitCode = code;
}
next.on("exit", (code) => stop(code || 0));
worker.on("exit", (code) => {
  if (!stopping)
    console.error(`Worker exited (${code}); restart with pnpm worker.`);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
