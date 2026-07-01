import { test as base } from "@playwright/test";
import { RunvaneApp } from "./pages/RunvaneApp";
import { waitForNoPendingTasks } from "./harness/client";
import { E2E_LLM_TIMEOUT_MS } from "./timeouts";

/** How long a test waits for backend tasks to drain before declaring a leak. */
const TASK_DRAIN_TIMEOUT_MS = Number(
  process.env.E2E_TASK_DRAIN_TIMEOUT_MS ?? E2E_LLM_TIMEOUT_MS + 2_000,
);

export const test = base.extend<{ app: RunvaneApp; drainPendingTasks: void }>({
  app: async ({ page }, use) => {
    // Surface browser-side failures into the run log (see scripts/test-diagnostics.mjs).
    // The harness only sees the backend; frontend errors live in the page.
    const title = test.info().title;
    page.on("pageerror", (err) => {
      console.error(`[browser pageerror] «${title}» ${err.message}\n${err.stack ?? ""}`);
    });
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") {
        console.error(`[browser console.${type}] «${title}» ${msg.text()}`);
      }
    });
    page.on("requestfailed", (req) => {
      // SSE streams and external assets abort on every navigation/unload — normal
      // teardown, not a failure. Only log genuine request failures.
      const url = req.url();
      const errorText = req.failure()?.errorText ?? "?";
      const isStreamAbort = /\/stream(\?|$)/.test(url) && errorText === "net::ERR_ABORTED";
      const isExternalAbort = !url.includes("127.0.0.1") && errorText === "net::ERR_ABORTED";
      if (isStreamAbort || isExternalAbort) return;
      console.error(`[browser requestfailed] «${title}» ${req.method()} ${url} — ${errorText}`);
    });
    await use(new RunvaneApp(page));
  },

  /**
   * Auto fixture: a test may never conclude while the backend still has
   * in-flight LLM/tool tasks. After the body settles we drain `/api/tasks`; a
   * leak that outlives the timeout fails the test — unless the body was already
   * failing, in which case we annotate instead so the primary error isn't
   * masked by the drain timeout.
   */
  drainPendingTasks: [
    async ({ request }, use) => {
      await use();
      const info = test.info();
      try {
        await waitForNoPendingTasks(request, { timeoutMs: TASK_DRAIN_TIMEOUT_MS });
      } catch (err) {
        if (info.errors.length === 0) throw err;
        const description = err instanceof Error ? err.message : String(err);
        info.annotations.push({ type: "pending-tasks", description });
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
