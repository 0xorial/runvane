import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { resolveFromDir } from "../dev-ports/lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const devPorts = resolveFromDir(__dirname);

const live = process.env.E2E_LIVE_LLM === "1";
const serversReady = process.env.E2E_SERVERS_READY === "1";
const uiTimeoutMs = Number(process.env.E2E_UI_TIMEOUT_MS ?? (live ? 5_000 : 1_000));
const llmTimeoutMs = Number(process.env.E2E_LLM_TIMEOUT_MS ?? (live ? 45_000 : 3_000));

const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${devPorts.ports.frontend}`;
const apiBaseURL = process.env.E2E_API_BASE_URL ?? devPorts.env.VITE_API_BASE_URL;
process.env.E2E_API_BASE_URL ??= apiBaseURL;

export default defineConfig({
  reporter: [
    ["list"],
    [path.join(__dirname, "../test-metrics/playwright-reporter.mjs")],
  ],
  testDir: path.join(__dirname, "e2e"),
  timeout: llmTimeoutMs + 5_000,
  workers: 1,
  expect: { timeout: uiTimeoutMs },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  metadata: { apiBaseURL },
  ...(!serversReady
    ? {
        webServer: {
          command: "node -e \"console.error('Run: npm run test:e2e'); process.exit(1)\"",
          url: baseURL,
          reuseExistingServer: false,
        },
      }
    : {}),
});
