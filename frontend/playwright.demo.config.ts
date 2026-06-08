import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { resolveFromDir } from "../dev-ports/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devPorts = resolveFromDir(__dirname);

const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${devPorts.ports.frontend}`;
const apiBaseURL = process.env.E2E_API_BASE_URL ?? devPorts.env.VITE_API_BASE_URL;
process.env.E2E_API_BASE_URL ??= apiBaseURL;

const VIDEO = { width: 1280, height: 800 };

// Records polished demo videos (not assertions). Driven by scripts/record-demos.mjs
// against the stub-LLM e2e harness, then converted to GIFs with ffmpeg.
export default defineConfig({
  testDir: path.join(__dirname, "demos"),
  testMatch: "**/runvane.demo.ts",
  outputDir: path.join(__dirname, "demo-output"),
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: VIDEO,
    video: { mode: "on", size: VIDEO },
    launchOptions: { slowMo: 350 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
