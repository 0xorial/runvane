#!/usr/bin/env node
// Record demo WebP — stub LLM (multi-model list + streamDelayMs); demos queue replies via /test/stub-llm.
// WebP needs `img2webp` (macOS: `brew install webp`).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const demoFilter = process.argv[2]?.trim() || "";
const demoDelayMs = Number(
  process.env.LLM_DEMO_DELAY_MS ?? (demoFilter === "steering" ? "35" : "20"),
);
const demoPtsFactor = Number(process.env.DEMO_PTS_FACTOR ?? "2");
const demoWebpFps = Number(process.env.DEMO_WEBP_FPS ?? "10");
const demoWebpScale = Number(process.env.DEMO_WEBP_SCALE ?? "1280");
const demoWebpQuality = Number(process.env.DEMO_WEBP_QUALITY ?? "50");
/** img2webp -m: 0=fast … 6=slowest. 6 was ~25× slower for negligible size win. */
const demoWebpMethod = Number(process.env.DEMO_WEBP_METHOD ?? "4");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendDir = path.join(repoRoot, "backend");
import { backendOrigin, ensureE2eServers, frontendOrigin, stopE2eServers } from "./e2e-servers.mjs";
import { e2eDatabaseUrl, prepareE2eDatabase } from "./e2e-db.mjs";

const testsDir = path.join(repoRoot, "tests");
const demosDir = path.join(repoRoot, "demos");
const outputDir = path.join(demosDir, "demo-output");
const demoDir = path.join(repoRoot, "docs", "demo");
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
    `UPDATE agents SET model_provider_id='stub', model_name='gpt-4o', default_llm_configuration_json='{"provider_id":"stub","model_name":"gpt-4o","tools":{"get_current_time":{"enabled":true},"ask_attachment":{"enabled":true,"rules":{"allowed":"always"}}}}' WHERE is_default=1;`,
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

function findImg2Webp() {
  for (const cmd of [
    process.env.IMG2WEBP,
    "img2webp",
    "/opt/homebrew/bin/img2webp",
    "/usr/local/bin/img2webp",
  ].filter(Boolean)) {
    const res = spawnSync(cmd, ["-version"], { stdio: "ignore" });
    if (res.status === 0) return cmd;
  }
  return null;
}

const img2webpBin = findImg2Webp();
if (!img2webpBin) {
  console.warn("img2webp not found — WebP output skipped (install: brew install webp)");
}

/** VP8/WebM → animated WebP via PNG frame burst (ffmpeg lacks libwebp here). */
function webmToWebp(webm, outWebp, ptsFactor) {
  if (!img2webpBin) return;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "runvane-demo-webp-"));
  try {
    const vf = `setpts=${ptsFactor}*PTS,fps=${demoWebpFps},scale=${demoWebpScale}:-1:flags=lanczos`;
    sh("ffmpeg", ["-y", "-i", webm, "-vf", vf, path.join(tmpDir, "frame_%04d.png")]);
    const frames = readdirSync(tmpDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(tmpDir, f));
    if (!frames.length) throw new Error(`webp: no frames extracted from ${webm}`);
    sh(img2webpBin, [
      "-loop",
      "0",
      "-lossy",
      "-d",
      String(Math.round(1000 / demoWebpFps)),
      "-m",
      String(demoWebpMethod),
      "-q",
      String(demoWebpQuality),
      "-o",
      outWebp,
      ...frames,
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Build backend so the stub demo changes are live.
console.log("Building backend…");
sh("npm", ["run", "build"], { cwd: backendDir });

mkdirSync(outputDir, { recursive: true });
mkdirSync(demoDir, { recursive: true });
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
  const dir = path.basename(path.dirname(webm));
  const hashed = dir.match(/^([a-z0-9-]+)--[a-f0-9]+-s-/);
  if (hashed) return hashed[1];
  const fromSuffix =
    dir.match(/\.demo\.ts-(.+)-chromium$/) ?? dir.match(/-demo\.ts-(.+)-chromium$/);
  if (fromSuffix) return fromSuffix[1];
  const base = dir.replace(/-chromium$/, "");
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
  webmToWebp(webm, path.join(demoDir, `${n}.webp`), demoPtsFactor);
}

console.log(`\n✓ Recorded ${videos.length} demo(s) to ${path.relative(repoRoot, demoDir)}/`);
for (const v of videos) console.log(`  - ${name(v)}`);
process.exit(code);
