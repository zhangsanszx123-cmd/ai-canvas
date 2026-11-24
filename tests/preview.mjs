import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "--port", "3001"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, APP_URL: "http://localhost:3001" },
  },
);
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
