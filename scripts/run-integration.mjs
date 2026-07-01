#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { integrationDatabaseUrl, prepareIntegrationDatabase } from "./e2e-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");
const testsDir = path.join(repoRoot, "tests");

const live = process.env.INTEGRATION_LIVE_LLM === "1";

// Build a fresh, isolated DB under .e2e/ before running. Integration tests must
// never touch the real backend.sqlite (rv-stable) or backend.dev.sqlite (rv-dev).
prepareIntegrationDatabase({ fresh: true });

const env = {
  ...process.env,
  RUN_INTEGRATION_TESTS: "1",
  // Hard override, placed after ...process.env, so an ambient DATABASE_URL
  // exported for rv-dev/prisma work can never leak into the test DB.
  DATABASE_URL: integrationDatabaseUrl,
  ...(live ? { INTEGRATION_LIVE_LLM: "1" } : {}),
};

const jestBin = path.join(backendDir, "node_modules/jest/bin/jest.js");
const jestConfig = path.join(testsDir, "jest.integration.json");

const child = spawn(
  process.execPath,
  [jestBin, "--config", jestConfig, "--forceExit", ...process.argv.slice(2)],
  { cwd: testsDir, env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
