import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { resolveFromDir } from "../dev-ports/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devPorts = resolveFromDir(__dirname);

const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${devPorts.ports.frontend}`;
const apiBaseURL = process.env.E2E_API_BASE_URL ?? devPorts.env.VITE_API_BASE_URL;
process.env.E2E_API_BASE_URL ??= apiBaseURL;

export default defineConfig({
  reporter: [
    ["list"],
    [path.join(__dirname, "../test-metrics/playwright-reporter.mjs")],
  ],
  testDir: path.join(__dirname, "e2e"),
  timeout: Number(process.env.E2E_LLM_TIMEOUT_MS ?? 5_000) + 10_000,
  workers: 1,
  expect: { timeout: Number(process.env.E2E_UI_TIMEOUT_MS ?? 10_000) },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  metadata: { apiBaseURL },
});
