#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backendOrigin,
  ensureE2eServers,
  frontendOrigin,
  stopE2eServers,
} from "./e2e-servers.mjs";
import { installTestDiagnostics } from "./test-diagnostics.mjs";

// Always write a durable log (harness + in-process backend + browser errors)
// to .e2e/logs/e2e-latest.log. Must run before anything else can throw.
const diag = installTestDiagnostics("e2e");

// Turn on backend request logging (pino) unless the caller overrides it — a
// failing run must always leave real logs behind. Set before the backend loads.
process.env.LOG_LEVEL ??= "info";
// Deep DB instrumentation (per-statement + per-transaction timing/concurrency).
// Feature-flagged; on for test runs, overridable. RUNVANE_DB_DIAG_ALL=1 for
// every statement instead of only slow ones.
process.env.RUNVANE_DB_DIAG ??= "1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const testsDir = path.join(repoRoot, "tests");

// The backend runs from TS source (see e2e-servers.mjs -> backend-src.mjs); no
// dist build step — dist is only for actually distributing the app.
const freshDb = process.env.E2E_FRESH_DB !== "0";
await stopE2eServers();
await ensureE2eServers({ freshDb });

const env = {
  ...process.env,
  RUN_E2E_TESTS: "1",
  E2E_SERVERS_READY: "1",
  PORT: String(new URL(backendOrigin).port),
  FRONTEND_ORIGIN: frontendOrigin,
  VITE_API_BASE_URL: backendOrigin,
  E2E_API_BASE_URL: backendOrigin,
  E2E_BASE_URL: frontendOrigin,
};

const playwrightArgs = ["playwright", "test", ...process.argv.slice(2)];

// Pipe (don't inherit) so Playwright + browser output flows through the teed
// stdout/stderr and lands in the log file too.
const child = spawn("npx", playwrightArgs, {
  cwd: testsDir,
  env,
  stdio: ["inherit", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("exit", (code, signal) => {
  diag.log(`playwright exited code=${code} signal=${signal}`);
  if (signal) process.kill(process.pid, signal);
  // Green-but-dirty runs (any exception/warning in the log) fail here.
  diag.enforceCleanExit(code);
});
