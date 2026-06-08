#!/usr/bin/env node
// Record demo GIFs/MP4s against a SIMULATED LLM — the stub in LLM_DEMO mode,
// which returns rich, prompt-aware content and streams it slowly (word by
// word), so it looks like a real model typing. Deterministic, free, no API.
process.env.LLM_DEMO = "1";
process.env.LLM_DEMO_DELAY_MS ??= "45";

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendOrigin, ensureE2eServers, frontendOrigin, stopE2eServers } from "./e2e-servers.mjs";
import { e2eDatabaseUrl } from "./e2e-db.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const frontendDir = path.join(repoRoot, "frontend");
const backendDir = path.join(repoRoot, "backend");
const outputDir = path.join(frontendDir, "demo-output");
const gifDir = path.join(repoRoot, "docs", "demo");
const demoDbPath = e2eDatabaseUrl.replace(/^file:/, "");

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${res.status}`);
}

// Build backend so the stub demo changes are live.
console.log("Building backend…");
sh("npm", ["run", "build"], { cwd: backendDir });

if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
mkdirSync(gifDir, { recursive: true });

console.log("Starting simulated-LLM servers…");
await stopE2eServers();
await ensureE2eServers({ freshDb: true });

// Give the default agent a real-looking model name (the picker then offers the
// other demo models for the multi-model compare).
sh("sqlite3", [
  demoDbPath,
  "UPDATE agents SET model_name='gpt-4o', default_llm_configuration_json=json_set(coalesce(default_llm_configuration_json,'{}'),'$.model_name','gpt-4o') WHERE is_default=1;",
]);

let code = 0;
await new Promise((resolve) => {
  const child = spawn("npx", ["playwright", "test", "--config=playwright.demo.config.ts"], {
    cwd: frontendDir,
    env: { ...process.env, E2E_BASE_URL: frontendOrigin, E2E_API_BASE_URL: backendOrigin },
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
const name = (webm) =>
  path.basename(path.dirname(webm)).replace(/-chromium$/, "").replace(/^.*?\.demo\.ts-/, "");

const videos = findVideos(outputDir);
for (const webm of videos) {
  const n = name(webm);
  console.log(`Converting ${n}…`);
  sh("ffmpeg", ["-y", "-i", webm, "-vf",
    "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
    path.join(gifDir, `${n}.gif`)]);
  sh("ffmpeg", ["-y", "-i", webm, "-movflags", "+faststart", "-pix_fmt", "yuv420p",
    "-vf", "scale=1280:-2", path.join(gifDir, `${n}.mp4`)]);
}

console.log(`\n✓ Recorded ${videos.length} demo(s) to ${path.relative(repoRoot, gifDir)}/`);
for (const v of videos) console.log(`  - ${name(v)}`);
process.exit(code);
