#!/usr/bin/env node
// Runs the whole test suite with ONE command: `npm test` (or
// `node scripts/run-all-tests.mjs [unit] [integration] [e2e]`).
//
// The only thing that makes running tests "tricky" in the hive container is
// that /workspace's node_modules ship the Mac's darwin-native binaries, which
// can't load on Linux (Prisma engines, rolldown/vite, Playwright). Linux builds
// of those live off the share under /shared/.cache. This script detects that
// situation and wires the env vars itself, so there is nothing to remember.
// On the Mac (or anywhere the shims are absent) it applies nothing and the
// native node_modules are used as-is.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const backendDir = path.join(repoRoot, "backend");

// --- Linux-native shims (see memory: runvane-prisma-linux-engine) -----------
// (Prisma 7 runs engine-free via the better-sqlite3 driver adapter, so only
// the vite natives and Playwright browsers still need Linux-side shims.)
const cache = "/shared/.cache";
const shims = {
  PLAYWRIGHT_BROWSERS_PATH: `${cache}/ms-playwright`,
};
// NODE_PATH is applied ONLY to the e2e run — a global NODE_PATH perturbs jest
// module resolution for the unit/integration layers.
const e2eNodePath = `${cache}/runvane-natives/node_modules`;

const onLinux = process.platform === "linux";
const shimsPresent = Object.values(shims).every(existsSync) && existsSync(e2eNodePath);
const useShims = onLinux && shimsPresent;

if (onLinux && !shimsPresent) {
  console.error(
    "run-all-tests: on Linux but the native test binaries are missing under\n" +
      `  ${cache}/runvane-natives, ${cache}/ms-playwright\n` +
      "Restore them before running (see memory note runvane-prisma-linux-engine).",
  );
  process.exit(1);
}

const baseEnv = useShims ? { ...process.env, ...shims } : { ...process.env };
const e2eEnv = useShims ? { ...baseEnv, NODE_PATH: e2eNodePath } : baseEnv;

// --- layers -----------------------------------------------------------------
const layers = {
  unit: { label: "unit (backend)", cmd: "npm", args: ["test"], cwd: backendDir, env: baseEnv },
  integration: {
    label: "integration",
    cmd: process.execPath,
    args: [path.join(repoRoot, "scripts/run-integration.mjs")],
    cwd: repoRoot,
    env: baseEnv,
  },
  e2e: {
    label: "e2e (playwright)",
    cmd: process.execPath,
    args: [path.join(repoRoot, "scripts/run-e2e.mjs")],
    cwd: repoRoot,
    env: e2eEnv,
  },
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const bail = process.argv.includes("--bail");
const order = ["unit", "integration", "e2e"];
const selected = requested.length ? requested : order;
for (const name of selected) {
  if (!layers[name]) {
    console.error(`run-all-tests: unknown layer "${name}" (expected: ${order.join(", ")})`);
    process.exit(2);
  }
}

function run({ label, cmd, args, cwd, env }) {
  return new Promise((resolve) => {
    console.log(`\n\x1b[1m▶ ${label}\x1b[0m`);
    const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

const results = [];
for (const name of selected) {
  const code = await run(layers[name]);
  results.push({ name, code });
  if (code !== 0 && bail) break;
}

console.log("\n\x1b[1m── test summary ──\x1b[0m");
for (const { name, code } of results) {
  console.log(`  ${code === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
}
const skipped = selected.filter((n) => !results.some((r) => r.name === n));
for (const name of skipped) console.log(`  \x1b[2mSKIP\x1b[0m  ${name} (bailed)`);

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
