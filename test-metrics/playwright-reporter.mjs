import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestId, recordBatch } from "./ledger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @implements {import('@playwright/test/reporter').Reporter} */
export default class TestMetricsReporter {
  constructor() {
    /** @type {Array<{ id: string, suite: string, status: 'passed' | 'failed' | 'skipped', message?: string }>} */
    this.batch = [];
  }

  onTestEnd(test, result) {
    if (result.status === "skipped") return;
    const status = result.status === "passed" ? "passed" : "failed";
    this.batch.push({
      id: makeTestId("e2e", test.location.file, test.title),
      suite: "e2e",
      status,
      message: result.error?.message,
    });
  }

  async onEnd() {
    if (this.batch.length > 0) recordBatch(this.batch);
  }
}
