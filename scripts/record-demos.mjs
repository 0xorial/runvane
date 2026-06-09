#!/usr/bin/env node
// Record demo GIFs/MP4s — stub LLM (multi-model list + streamDelayMs); demos queue replies via /test/stub-llm.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const demoFilter = process.argv[2]?.trim() || "";
const demoDelayMs = Number(
  process.env.LLM_DEMO_DELAY_MS ?? (demoFilter === "steering" ? "35" : "20"),
);
const demoPtsFactor = Number(process.env.DEMO_PTS_FACTOR ?? "2");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(repoRoot, "backend");
import { backendOrigin, ensureE2eServers, frontendOrigin, stopE2eServers } from "./e2e-servers.mjs";
import { e2eDatabaseUrl, prepareE2eDatabase } from "./e2e-db.mjs";

const frontendDir = path.join(repoRoot, "frontend");
const outputDir = path.join(frontendDir, "demo-output");
const gifDir = path.join(repoRoot, "docs", "demo");
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
    `UPDATE agents SET model_provider_id='stub', model_name='gpt-4o', default_llm_configuration_json='{"provider_id":"stub","model_name":"gpt-4o","tools":{"get_current_time":{"enabled":true}}}' WHERE is_default=1;`,
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
mkdirSync(gifDir, { recursive: true });
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
  const playwrightArgs = ["playwright", "test", "--config=playwright.demo.config.ts"];
  if (demoFilter) playwrightArgs.push("--grep", demoFilter);
  const child = spawn("npx", playwrightArgs, {
    cwd: frontendDir,
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

function findVideos(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findVideos(full));
    else if (e.name.endsWith(".webm")) out.push(full);
  }
  return out;
}
const name = (webm) => {
  const base = path.basename(path.dirname(webm)).replace(/-chromium$/, "");
  const dup = base.match(/^([a-z0-9-]+)-\1\.demo\.ts-/);
  if (dup) return dup[1];
  const plain = base.match(/^([a-z0-9-]+)\.demo\.ts-/);
  return plain ? plain[1] : base.replace(/\.demo\.ts.*$/, "");
};

let videos = findVideos(outputDir);
if (demoFilter) videos = videos.filter((webm) => name(webm).includes(demoFilter));
for (const webm of videos) {
  const n = name(webm);
  console.log(`Converting ${n}…`);
  const pts = `setpts=${demoPtsFactor}*PTS`;
  sh("ffmpeg", ["-y", "-i", webm, "-vf",
    `${pts},fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    path.join(gifDir, `${n}.gif`)]);
  sh("ffmpeg", ["-y", "-i", webm, "-movflags", "+faststart", "-pix_fmt", "yuv420p",
    "-vf", `${pts},scale=1280:-2`, path.join(gifDir, `${n}.mp4`)]);
}

console.log(`\n✓ Recorded ${videos.length} demo(s) to ${path.relative(repoRoot, gifDir)}/`);
for (const v of videos) console.log(`  - ${name(v)}`);
process.exit(code);
