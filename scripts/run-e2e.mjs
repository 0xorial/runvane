#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backendOrigin,
  ensureE2eServers,
  frontendOrigin,
  stopE2eServers,
} from "./e2e-servers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const frontendDir = path.join(repoRoot, process.env.E2E_FRONTEND_DIR ?? "frontend");
const backendDir = path.join(repoRoot, "backend");
const backendMain = path.join(backendDir, "dist/main.js");

if (!existsSync(backendMain)) {
  const build = spawnSync("npm", ["run", "build"], { cwd: backendDir, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

await stopE2eServers();
await ensureE2eServers({ freshDb: true });

const env = {
  ...process.env,
  RUN_E2E_TESTS: "1",
  E2E_SERVERS_READY: "1",
  LLM_TEST_STUB: "1",
  PORT: String(new URL(backendOrigin).port),
  FRONTEND_ORIGIN: frontendOrigin,
  VITE_API_BASE_URL: backendOrigin,
  E2E_API_BASE_URL: backendOrigin,
  E2E_BASE_URL: frontendOrigin,
};

const playwrightCwd = path.join(repoRoot, "frontend");
const playwrightArgs = ["playwright", "test", ...process.argv.slice(2)];
if (process.env.E2E_FRONTEND_DIR === "frontend3") {
  playwrightArgs.push("-c", path.join(repoRoot, "frontend/playwright.frontend3.config.mjs"));
}

const child = spawn("npx", playwrightArgs, {
  cwd: playwrightCwd,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
