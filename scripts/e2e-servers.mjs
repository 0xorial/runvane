#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { e2eDatabaseUrl, prepareE2eDatabase } from "./e2e-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const pidFile = path.join(repoRoot, ".e2e-servers.json");

export const E2E_DEV_BASE = 523;
export const backendPort = E2E_DEV_BASE * 100;
const frontendPortOffset = Number(process.env.E2E_FRONTEND_PORT_OFFSET ?? "1");
export const frontendPort = backendPort + frontendPortOffset;
export const backendOrigin = `http://127.0.0.1:${backendPort}`;
export const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

async function healthOk() {
  try {
    const res = await fetch(`${backendOrigin}/health`);
    if (!res.ok) return false;
    const body = await res.json();
    return body.llmMode === "stub";
  } catch {
    return false;
  }
}

async function frontendOk() {
  try {
    const res = await fetch(frontendOrigin);
    return res.ok;
  } catch {
    return false;
  }
}

function readPids() {
  if (!existsSync(pidFile)) return null;
  return JSON.parse(readFileSync(pidFile, "utf8"));
}

function writePids(pids) {
  writeFileSync(pidFile, `${JSON.stringify(pids, null, 2)}\n`);
}

function spawnDetached(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

async function waitFor(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`e2e-servers: timeout waiting for ${label}`);
}

export async function ensureE2eServers({ freshDb = false } = {}) {
  if (!freshDb && (await healthOk()) && (await frontendOk())) return;

  const backendMain = path.join(repoRoot, "backend/dist/main.js");
  if (!existsSync(backendMain)) {
    throw new Error("e2e-servers: run `cd backend && npm run build` first");
  }

  prepareE2eDatabase({ fresh: freshDb });

  const pids = {
    backend: spawnDetached("node", ["dist/main.js"], path.join(repoRoot, "backend"), {
      LLM_TEST_STUB: "1",
      NODE_ENV: "test",
      DATABASE_URL: e2eDatabaseUrl,
      PORT: String(backendPort),
      FRONTEND_ORIGIN: frontendOrigin,
    }),
    frontend: spawnDetached(
      "npx",
      ["vite", "--host", "127.0.0.1", "--strictPort", "--port", String(frontendPort)],
      path.join(repoRoot, process.env.E2E_FRONTEND_DIR ?? "frontend"),
      { VITE_API_BASE_URL: backendOrigin },
    ),
  };
  writePids(pids);

  await waitFor(healthOk, "stub backend /health");
  await waitFor(frontendOk, "frontend");
}

export async function stopE2eServers() {
  const pids = readPids();
  if (!pids) return;
  for (const pid of [pids.backend, pids.frontend]) {
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        /* already stopped */
      }
    }
  }
  unlinkSync(pidFile);
}

const isCli = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isCli) {
  const cmd = process.argv[2];
  if (cmd === "start") {
    await ensureE2eServers();
    console.log(`e2e servers: ${backendOrigin} + ${frontendOrigin}`);
  } else if (cmd === "stop") {
    await stopE2eServers();
    console.log("e2e servers stopped");
  } else if (cmd === "status") {
    console.log(
      `backend=${(await healthOk()) ? "stub ok" : "down"} frontend=${(await frontendOk()) ? "ok" : "down"}`,
    );
  } else {
    console.error("usage: e2e-servers.mjs start|stop|status");
    process.exit(1);
  }
}
