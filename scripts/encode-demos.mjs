#!/usr/bin/env node
// Encode demo masters (demos/demo-output/**/video.webm, Playwright VP8) into
// docs/demo/: H.264 MP4 + VP9 WebM (2× slowed, like the recordings were tuned
// for) plus a JPEG poster, served by GitHub Pages (main:/docs). Needs only
// `ffmpeg`. Run standalone (`npm run demos:encode [filter]`) or via
// record-demos.mjs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ptsFactor = Number(process.env.DEMO_PTS_FACTOR ?? "2");
const videoScale = Number(process.env.DEMO_VIDEO_SCALE ?? "1280");
const x264Crf = Number(process.env.DEMO_X264_CRF ?? "22");
const vp9Crf = Number(process.env.DEMO_VP9_CRF ?? "32");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const demoOutputDir = path.join(repoRoot, "demos", "demo-output");
export const siteDemoDir = path.join(repoRoot, "docs", "demo");

function sh(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${res.status}`);
}

export function findVideos(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findVideos(full));
    else if (e.name.endsWith(".webm")) out.push(full);
  }
  return out;
}

export function demoName(webm) {
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
}

function sourceDurationSec(webm) {
  const res = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm],
    { encoding: "utf8" },
  );
  const dur = Number(res.stdout?.trim());
  return Number.isFinite(dur) && dur > 0 ? dur : 0;
}

export function encodeDemo(webm, name) {
  mkdirSync(siteDemoDir, { recursive: true });
  const vf = `setpts=${ptsFactor}*PTS,fps=25,scale=${videoScale}:-2:flags=lanczos`;
  const common = ["-y", "-i", webm, "-vf", vf, "-an", "-pix_fmt", "yuv420p"];
  sh("ffmpeg", [
    ...common,
    "-c:v", "libx264", "-crf", String(x264Crf), "-preset", "slow",
    "-profile:v", "high", "-movflags", "+faststart",
    path.join(siteDemoDir, `${name}.mp4`),
  ]);
  sh("ffmpeg", [
    ...common,
    "-c:v", "libvpx-vp9", "-crf", String(vp9Crf), "-b:v", "0",
    "-row-mt", "1", "-cpu-used", "1",
    path.join(siteDemoDir, `${name}.webm`),
  ]);
  const posterAt = sourceDurationSec(webm) * 0.62;
  sh("ffmpeg", [
    "-y", "-ss", posterAt.toFixed(2), "-i", webm, "-frames:v", "1", "-update", "1",
    "-vf", `scale=${videoScale}:-2:flags=lanczos`, "-q:v", "5",
    path.join(siteDemoDir, `${name}.jpg`),
  ]);
}

export function encodeAll(filter = "") {
  let videos = findVideos(demoOutputDir);
  if (filter) videos = videos.filter((webm) => demoName(webm).includes(filter));
  for (const webm of videos) {
    const n = demoName(webm);
    console.log(`Encoding ${n}…`);
    encodeDemo(webm, n);
  }
  return videos.map(demoName);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = encodeAll(process.argv[2]?.trim() || "");
  if (!names.length) {
    console.error("No demo masters found — run `npm run demos` first.");
    process.exit(1);
  }
  console.log(`\n✓ Encoded ${names.length} demo(s) to ${path.relative(repoRoot, siteDemoDir)}/`);
  for (const n of names) console.log(`  - ${n}`);
}
