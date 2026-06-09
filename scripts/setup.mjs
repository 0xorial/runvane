#!/usr/bin/env node
// One-shot setup: deps, env, ports, database. Idempotent — safe to re-run.
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(repoRoot, "backend");
const frontendDir = path.join(repoRoot, "frontend");
const testsDir = path.join(repoRoot, "tests");

function run(cmd, args, cwd) {
  console.log(`\n\x1b[36m> ${cmd} ${args.join(" ")}\x1b[0m  (${path.relative(repoRoot, cwd) || "."})`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`\n\x1b[31mSetup failed at: ${cmd} ${args.join(" ")}\x1b[0m`);
    process.exit(res.status ?? 1);
  }
}

// 1. Backend env file (Prisma needs DATABASE_URL; runtime falls back to the same path).
const backendEnv = path.join(backendDir, ".env");
if (!existsSync(backendEnv)) {
  copyFileSync(path.join(backendDir, ".env.example"), backendEnv);
  console.log(`Created backend/.env from .env.example`);
} else {
  console.log(`backend/.env already exists — leaving it`);
}

// 2. Dev ports (.env.ports).
run("node", ["dev-ports/sync-env.mjs"], repoRoot);

// 3. Install dependencies.
run("npm", ["install"], backendDir);
run("npm", ["install"], frontendDir);
run("npm", ["install"], testsDir);
run("npx", ["playwright", "install", "chromium"], testsDir);

// 4. Database: generate client + apply migrations.
run("npx", ["prisma", "generate"], backendDir);
run("npx", ["prisma", "migrate", "deploy"], backendDir);

console.log(`
\x1b[32m✓ Setup complete.\x1b[0m

  Start the app:    \x1b[36mnpm run dev\x1b[0m
  E2E tests:        \x1b[36mnpm run test:e2e\x1b[0m
  Show dev ports:   \x1b[36mnpm run ports\x1b[0m

Then open the frontend URL, go to Settings, and add an LLM provider
(an API key, or point it at a local LM Studio server to run free/offline).
`);
