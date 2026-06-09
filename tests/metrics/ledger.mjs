import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const LEDGER_PATH = path.join(__dirname, "ledger.json");
const LAST_RUN_PATH = path.join(__dirname, "last-run.json");

function emptyEntry() {
  return {
    runs: 0,
    fails: 0,
    /** Manual: times we changed this test because it was brittle/wrong. */
    fragility: 0,
    failKinds: { timeout: 0, assertion: 0, other: 0 },
    lastRunAt: null,
    lastStatus: null,
    lastFailAt: null,
    lastFailMessage: null,
  };
}

function normalizeEntry(entry) {
  if (entry.fragility == null) {
    entry.fragility = entry.usefulFails ?? 0;
    delete entry.usefulFails;
  }
  return entry;
}

export function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return { version: 1, updatedAt: null, tests: {} };
  }
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  for (const [id, entry] of Object.entries(ledger.tests)) {
    ledger.tests[id] = normalizeEntry(entry);
  }
  return ledger;
}

function writeLedger(ledger) {
  ledger.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

export function makeTestId(suite, filePath, title) {
  const rel = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
  return `${suite}:${rel}::${title}`;
}

function classifyFailure(message) {
  const text = String(message || "");
  if (/timeout|timed out|exceeded/i.test(text)) return "timeout";
  if (/expect\(|assertion|AssertionError|toBe|toEqual|Error:/i.test(text)) return "assertion";
  return "other";
}

/**
 * @param {Array<{ id: string, suite: string, status: 'passed' | 'failed' | 'skipped', message?: string }>} results
 */
export function recordBatch(results) {
  const ledger = readLedger();
  const lastRun = {
    runAt: new Date().toISOString(),
    failures: [],
  };

  for (const row of results) {
    if (row.status === "skipped") continue;

    const entry = normalizeEntry(ledger.tests[row.id] ?? emptyEntry());
    entry.runs += 1;
    entry.lastRunAt = lastRun.runAt;
    entry.lastStatus = row.status;

    if (row.status === "failed") {
      entry.fails += 1;
      entry.lastFailAt = lastRun.runAt;
      entry.lastFailMessage = row.message ? String(row.message).slice(0, 500) : null;
      const kind = classifyFailure(row.message);
      entry.failKinds[kind] += 1;
      lastRun.failures.push({
        id: row.id,
        suite: row.suite,
        kind,
        message: entry.lastFailMessage,
      });
    }

    ledger.tests[row.id] = entry;
  }

  writeLedger(ledger);
  fs.writeFileSync(LAST_RUN_PATH, `${JSON.stringify(lastRun, null, 2)}\n`);
  return { recorded: results.filter((r) => r.status !== "skipped").length, failures: lastRun.failures.length };
}

/** Record that this test needed a code change (brittle/wrong test, not app bug). */
export function recordFragility(testId, note) {
  const ledger = readLedger();
  const entry = normalizeEntry(ledger.tests[testId] ?? emptyEntry());
  entry.fragility += 1;
  if (note) entry.lastFragilityNote = String(note).slice(0, 500);
  entry.lastFragilityAt = new Date().toISOString();
  ledger.tests[testId] = entry;
  writeLedger(ledger);
}

function pct(num, den) {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function printReport() {
  const ledger = readLedger();
  const rows = Object.entries(ledger.tests).sort(([a], [b]) => a.localeCompare(b));

  if (rows.length === 0) {
    console.log("test-metrics: no runs recorded yet");
    return;
  }

  const header = ["test", "runs", "fails", "fragility", "failRate", "last"];
  const lines = [header.join("\t")];

  let totalRuns = 0;
  let totalFails = 0;
  let totalFragility = 0;

  for (const [id, entry] of rows) {
    totalRuns += entry.runs;
    totalFails += entry.fails;
    totalFragility += entry.fragility;
    const shortId = id.length > 72 ? `…${id.slice(-71)}` : id;
    lines.push(
      [
        shortId,
        entry.runs,
        entry.fails,
        entry.fragility,
        pct(entry.fails, entry.runs),
        entry.lastStatus ?? "—",
      ].join("\t"),
    );
  }

  console.log(lines.join("\n"));
  console.log("");
  console.log(
    `totals: runs=${totalRuns} fails=${totalFails} fragility=${totalFragility} failRate=${pct(totalFails, totalRuns)}`,
  );

  if (fs.existsSync(LAST_RUN_PATH)) {
    const lastRun = JSON.parse(fs.readFileSync(LAST_RUN_PATH, "utf8"));
    if (lastRun.failures?.length) {
      console.log("");
      console.log(`last run failures (${lastRun.runAt}):`);
      for (const failure of lastRun.failures) {
        console.log(`  [${failure.kind}] ${failure.id}`);
        if (failure.message) console.log(`    ${failure.message.split("\n")[0]}`);
      }
    }
  }

  console.log("");
  console.log("after fixing a brittle test (you changed the test, not the app):");
  console.log("  node tests/metrics/cli.mjs fragile <test-id> [optional note]");
}
