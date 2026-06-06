const path = require("node:path");

/** @implements {import('@jest/reporters').Reporter} */
class TestMetricsReporter {
  constructor(_globalConfig, options = {}) {
    this.suite = options.suite ?? "jest";
  }

  async onRunComplete(_contexts, results) {
    const { recordBatch, makeTestId } = await import(path.join(__dirname, "ledger.mjs"));
    const batch = [];

    for (const fileResult of results.testResults) {
      for (const test of fileResult.testResults) {
        if (test.status === "pending" || test.status === "skipped") continue;
        const title = [...test.ancestorTitles, test.title].join(" > ");
        batch.push({
          id: makeTestId(this.suite, fileResult.testFilePath, title),
          suite: this.suite,
          status: test.status === "failed" ? "failed" : "passed",
          message: test.failureMessages?.join("\n"),
        });
      }
    }

    if (batch.length > 0) recordBatch(batch);
  }
}

module.exports = TestMetricsReporter;
