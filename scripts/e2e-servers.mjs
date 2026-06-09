#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { e2eDatabaseUrl, prepareE2eDatabase } from "./e2e-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

export const E2E_DEV_BASE = 523;
export const backendPort = E2E_DEV_BASE * 100;
const frontendPortOffset = Number(process.env.E2E_FRONTEND_PORT_OFFSET ?? "1");
export const frontendPort = backendPort + frontendPortOffset;
export const backendOrigin = `http://127.0.0.1:${backendPort}`;
export const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

/** @type {{ backend: import('../backend/dist/bootstrap.js').RunvaneAppHandle | null; frontend: import('vite').ViteDevServer | null; llmMode: string | null }} */
const running = { backend: null, frontend: null, llmMode: null };

/** In-process stub LLM control when harness runs with `llm.mode === 'stub'`. */
export function getStubLlm() {
  return running.backend?.stubLlm ?? null;
}

async function healthOk() {
  try {
    const res = await fetch(`${backendOrigin}/health`);
    if (!res.ok) return false;
    const body = await res.json();
    return body.llmMode === running.llmMode;
  } catch {
    return false;
  }
}

function frontendDirName() {
  return process.env.E2E_FRONTEND_DIR ?? "frontend";
}

function frontendEntryPath() {
  return "/src/App.svelte";
}

async function frontendOk() {
  try {
    const index = await fetch(frontendOrigin);
    if (!index.ok) return false;
    const entry = await fetch(`${frontendOrigin}${frontendEntryPath()}`);
    if (!entry.ok) return false;
    const body = await entry.text();
    return body.length > 64 && !body.includes("<title>Error</title>");
  } catch {
    return false;
  }
}

async function loadBackendBootstrap() {
  const bootstrapPath = path.join(repoRoot, "backend/dist/bootstrap.js");
  if (!existsSync(bootstrapPath)) {
    throw new Error("e2e-servers: run `cd backend && npm run build` first");
  }
  return import(pathToFileURL(bootstrapPath).href);
}

async function loadFrontendDevServer() {
  const modPath = path.join(repoRoot, "tests", "e2e-dev-server.mjs");
  return import(pathToFileURL(modPath).href);
}

async function waitFor(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`e2e-servers: timeout waiting for ${label}`);
}

function resolveDatabaseUrl() {
  const override = process.env.E2E_DATABASE_URL?.trim();
  return override || e2eDatabaseUrl;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.freshDb]
 * @param {import('../backend/dist/runtime/runtime.config.js').LlmRuntime} [opts.llm]
 */
export async function ensureE2eServers({ freshDb = false, llm = { mode: "stub" } } = {}) {
  if (!freshDb && running.backend && running.frontend && (await healthOk()) && (await frontendOk())) {
    return;
  }

  const backendMain = path.join(repoRoot, "backend/dist/main.js");
  if (!existsSync(backendMain)) {
    throw new Error("e2e-servers: run `cd backend && npm run build` first");
  }

  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl === e2eDatabaseUrl) {
    prepareE2eDatabase({ fresh: freshDb });
  } else if (freshDb) {
    throw new Error("e2e-servers: E2E_FRESH_DB=1 cannot wipe a custom E2E_DATABASE_URL");
  }

  await stopE2eServers();

  running.llmMode = llm.mode;
  const { createRunvaneApp } = await loadBackendBootstrap();
  running.backend = await createRunvaneApp({
    llm,
    nodeEnv: "test",
    port: backendPort,
    frontendOrigin,
    databaseUrl,
  });

  const { createE2eFrontend } = await loadFrontendDevServer();
  const frontendDir = path.join(repoRoot, frontendDirName());
  running.frontend = await createE2eFrontend({
    root: frontendDir,
    port: frontendPort,
    apiBaseUrl: backendOrigin,
  });

  await waitFor(healthOk, `${llm.mode} backend /health`);
  await waitFor(frontendOk, `${frontendDirName()} vite (${frontendEntryPath()})`);
}

export async function stopE2eServers() {
  if (running.backend) {
    await running.backend.close();
    running.backend = null;
  }
  if (running.frontend) {
    const { closeE2eFrontend } = await loadFrontendDevServer();
    await closeE2eFrontend(running.frontend);
    running.frontend = null;
  }
}

const isCli = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isCli) {
  const cmd = process.argv[2];
  if (cmd === "start") {
    await ensureE2eServers();
    console.log(`e2e servers: ${backendOrigin} + ${frontendOrigin}`);
    const shutdown = async () => {
      await stopE2eServers();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => {});
  } else if (cmd === "stop") {
    await stopE2eServers();
    console.log("e2e servers stopped");
  } else if (cmd === "status") {
    const owned = running.backend != null && running.frontend != null;
    console.log(
      `owned=${owned} backend=${(await healthOk()) ? `${running.llmMode ?? "?"} ok` : "down"} frontend=${(await frontendOk()) ? "ok" : "down"}`,
    );
  } else {
    console.error("usage: e2e-servers.mjs start|stop|status");
    process.exit(1);
  }
}
