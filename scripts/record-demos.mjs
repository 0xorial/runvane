#!/usr/bin/env node
// Record demo videos — stub LLM (multi-model list + streamDelayMs); demos queue replies via /test/stub-llm.
// Masters land in demos/demo-output/, then encode-demos.mjs turns them into
// docs/demo/ MP4 + WebM + poster (needs `ffmpeg`).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeAll, siteDemoDir } from "./encode-demos.mjs";

const demoFilter = process.argv[2]?.trim() || "";
const demoDelayMs = Number(
  process.env.LLM_DEMO_DELAY_MS ?? (demoFilter === "steering" ? "35" : "20"),
);

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(repoRoot, "backend");
import { backendOrigin, ensureE2eServers, frontendOrigin, stopE2eServers } from "./e2e-servers.mjs";
import { e2eDatabaseUrl, prepareE2eDatabase } from "./e2e-db.mjs";

const testsDir = path.join(repoRoot, "tests");
const demosDir = path.join(repoRoot, "demos");
const outputDir = path.join(demosDir, "demo-output");
const demoDbPath = e2eDatabaseUrl.replace(/^file:/, "");
async function loadStubDemoModels() {
  const mod = await import(
    pathToFileURL(path.join(backendDir, "dist/llmProviders/providers/stubLlm.models.js")).href
  );
  return mod.STUB_DEMO_MODELS;
}

async function applyDemoDbPatch(demoModels) {
  const demoModelsJson = JSON.stringify([...demoModels]);
  const now = new Date().toISOString();
  for (const stmt of [
    `INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES ('llm_configuration', '{"provider_id":"stub","model_name":"gpt-4o","model_settings":{}}', '${now}');`,
    `UPDATE agents SET model_provider_id='stub', model_name='gpt-4o', default_llm_configuration_json='{"provider_id":"stub","model_name":"gpt-4o","tools":{"get_current_time":{"policy":"allow"},"ask_attachment":{"policy":"allow"}}}' WHERE is_default=1;`,
    `UPDATE llm_providers SET models_json='${demoModelsJson}', models_verified=1 WHERE id='stub';`,
    `UPDATE llm_providers SET models_verified=0 WHERE id!='stub';`,
  ]) {
    sh("sqlite3", [demoDbPath, stmt]);
  }
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${res.status}`);
}

// Build backend so the stub demo changes are live.
console.log("Building backend…");
sh("npm", ["run", "build"], { cwd: backendDir });

mkdirSync(outputDir, { recursive: true });
if (demoFilter) {
  for (const e of readdirSync(outputDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.includes(demoFilter)) {
      rmSync(path.join(outputDir, e.name), { recursive: true, force: true });
    }
  }
} else if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
}

console.log("Preparing demo database…");
await stopE2eServers();
prepareE2eDatabase({ fresh: true });
const stubDemoModels = await loadStubDemoModels();
await applyDemoDbPatch(stubDemoModels);

console.log("Starting simulated-LLM servers…");
await ensureE2eServers({
  freshDb: false,
  llm: { mode: "stub", streamDelayMs: demoDelayMs, models: [...stubDemoModels] },
});

let code = 0;
await new Promise((resolve) => {
  const playwrightArgs = ["playwright", "test", "--config=playwright.demo.config.mts"];
  if (demoFilter) playwrightArgs.push("--grep", demoFilter);
  const child = spawn("npx", playwrightArgs, {
    cwd: testsDir,
    env: {
      ...process.env,
      E2E_BASE_URL: frontendOrigin,
      E2E_API_BASE_URL: backendOrigin,
      E2E_LLM_TIMEOUT_MS: "5000",
      LLM_DEMO_DELAY_MS: String(demoDelayMs),
    },
    stdio: "inherit",
  });
  child.on("exit", (c) => { code = c ?? 1; resolve(); });
});

await stopE2eServers();

const { encoded, failed } = encodeAll(demoFilter);
console.log(`\n✓ Recorded ${encoded.length} demo(s) to ${path.relative(repoRoot, siteDemoDir)}/`);
for (const n of encoded) console.log(`  - ${n}`);
if (failed.length) {
  console.error(`\n✗ ${failed.length} demo(s) FAILED and were not encoded: ${failed.join(", ")}`);
}
process.exit(code || (failed.length ? 1 : 0));
