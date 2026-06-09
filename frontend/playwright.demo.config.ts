import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.E2E_BASE_URL?.trim() || !process.env.E2E_API_BASE_URL?.trim()) {
  throw new Error(
    "Demo tests require E2E_BASE_URL and E2E_API_BASE_URL (run `npm run demos`, not playwright directly against dev).",
  );
}
const baseURL = process.env.E2E_BASE_URL;
const apiBaseURL = process.env.E2E_API_BASE_URL;

const VIDEO = { width: 1280, height: 800 };

// Records polished demo videos (not assertions). Driven by scripts/record-demos.mjs
// against the stub-LLM e2e harness, then converted to GIFs with ffmpeg.
export default defineConfig({
  testDir: path.join(__dirname, "demos"),
  testMatch: "**/runvane.demo.ts",
  outputDir: path.join(__dirname, "demo-output"),
  timeout: 15_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: VIDEO,
    video: { mode: "on", size: VIDEO },
    launchOptions: { slowMo: 80 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
