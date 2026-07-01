// Always-on diagnostics for the test harness. Imported by run-e2e.mjs and
// run-integration.mjs so EVERY run leaves a durable log on disk — the backend
// runs in-process, so a background DB error (e.g. a Prisma P1008/P2028 timeout)
// used to become an unhandled rejection that silently killed the whole run with
// no trace. Now it is always captured, with the event-loop-lag context needed to
// tell "the DB was slow" apart from "the JS event loop was blocked".
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} suite  e.g. "e2e" or "integration"
 * @returns {{ logPath: string, latestPath: string, log: (msg: string) => void }}
 */
export function installTestDiagnostics(suite) {
  const logDir = path.join(repoRoot, ".e2e", "logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDir, `${suite}-${stamp}.log`);
  const latestPath = path.join(logDir, `${suite}-latest.log`);
  const dated = createWriteStream(logPath, { flags: "a" });
  const latest = createWriteStream(latestPath, { flags: "w" });
  const toFile = (chunk) => {
    dated.write(chunk);
    latest.write(chunk);
  };

  // Tee the harness + in-process-backend console output to the log files. The
  // Playwright child is piped through here by the caller, so specs land too.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => {
    toFile(chunk);
    return origOut(chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    toFile(chunk);
    return origErr(chunk, ...rest);
  };

  const log = (msg) => process.stderr.write(`[diag ${new Date().toISOString()}] ${msg}\n`);

  // Event-loop lag sampler: fire every INTERVAL ms, record how late we actually
  // ran. A multi-second lag right before a Prisma timeout means the loop was
  // blocked (not the DB). Kept in a ring buffer so we can dump it on failure.
  const INTERVAL = 50;
  const samples = []; // { t: ISO, lag: ms }
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lag = Math.round(now - lastTick - INTERVAL);
    lastTick = now;
    samples.push({ t: new Date().toISOString(), lag });
    if (samples.length > 1200) samples.shift();
    if (lag > 300) log(`loop-lag lag=${lag}ms`);
  }, INTERVAL).unref();
  const worstRecentLag = () =>
    [...samples]
      .sort((a, b) => b.lag - a.lag)
      .slice(0, 6)
      .map((s) => `${s.lag}ms@${s.t}`)
      .join(" | ") || "(no samples)";

  process.on("unhandledRejection", (reason) => {
    const r = /** @type {any} */ (reason) ?? {};
    log(`UNHANDLED_REJECTION code=${r.code} name=${r.name} msg=${String(r.message).slice(0, 300)}`);
    log(`  worst-recent-loop-lag: ${worstRecentLag()}`);
    if (r.stack) toFile(`${r.stack}\n`);
    // Do NOT rethrow: a single background DB timeout must not kill the whole
    // run without a trace. It is now logged above; the owning spec still fails.
  });
  process.on("uncaughtException", (err) => {
    log(`UNCAUGHT_EXCEPTION code=${err?.code} msg=${err?.message}`);
    log(`  worst-recent-loop-lag: ${worstRecentLag()}`);
    if (err?.stack) toFile(`${err.stack}\n`);
    // An uncaught exception means the harness state is broken (e.g. a server
    // failed to start). Exit loudly — swallowing it turns a crash into an
    // infinite hang with only the metrics sampler still ticking.
    log(`aborting run (uncaught exception)`);
    process.exit(1);
  });
  process.on("exit", (code) => log(`exit code=${code} — full log: ${logPath}`));

  log(`diagnostics armed for '${suite}' → ${latestPath}`);
  return { logPath, latestPath, log };
}
