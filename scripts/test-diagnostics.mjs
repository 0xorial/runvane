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

  // Zero-tolerance gate: a run is dirty if its log contains any exception or
  // warning, even when every spec passed. The runner calls enforceCleanExit()
  // and turns a "green but dirty" run into a failure. Third-party noise we
  // can't fix must be allowlisted here EXPLICITLY, with a reason.
  const PROBLEM_PATTERNS = [
    /UNCAUGHT_EXCEPTION|UNHANDLED_REJECTION/, //   diagnostics' own crash reports
    /\[browser (pageerror|console\.(error|warning)|requestfailed)\]/, // frontend
    /"level":(50|60)/, //                          pino error/fatal from the backend
    /\[vite-plugin-svelte\]/, //                   svelte compiler warnings
    /\b(ExperimentalWarning|DeprecationWarning)\b/, // Node runtime warnings
    /\b(TypeError|ReferenceError|RangeError|SyntaxError):/,
  ];
  const ALLOWLIST = [
    // node:sqlite is a deliberate dependency (rag-store.ts); Node 22 flags it.
    /ExperimentalWarning: SQLite is an experimental feature/,
    // Chromium's internal PDF viewer keeps a streaming fetch of the preview
    // iframe's blob: URL open; closing the page at test end aborts it. Benign
    // and unfixable from the app (networkidle can't be awaited — SSE), so it
    // is allowlisted ONLY for the spec that previews a PDF chip. Other blob
    // aborts (e.g. object-URL churn revoking a loading preview) still fail.
    /\[browser requestfailed\] «direct PDFs price per sniffed page.*GET blob:.*ERR_ABORTED/,
    // Chrome logs its own console.error for every 500 response; this spec
    // triggers one ON PURPOSE to prove error bodies carry message + stack
    // into the dialog. Scoped to that spec — unexpected 500s elsewhere fail.
    /\[browser console\.error\] «a failing create returns the real technical error.*Failed to load resource.*500/,
  ];
  const problems = [];
  let lineBuf = "";
  const scan = (chunk) => {
    lineBuf += chunk.toString();
    let nl;
    while ((nl = lineBuf.indexOf("\n")) !== -1) {
      const line = lineBuf.slice(0, nl);
      lineBuf = lineBuf.slice(nl + 1);
      if (!PROBLEM_PATTERNS.some((p) => p.test(line))) continue;
      if (ALLOWLIST.some((p) => p.test(line))) continue;
      if (problems.length < 50) problems.push(line.slice(0, 300));
      else if (problems.length === 50) problems.push("… (more problems truncated)");
    }
  };

  // Tee the harness + in-process-backend console output to the log files. The
  // Playwright child is piped through here by the caller, so specs land too.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => {
    toFile(chunk);
    scan(chunk);
    return origOut(chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    toFile(chunk);
    scan(chunk);
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

  /**
   * Call with the child's exit code. Exits the process: non-zero passes through;
   * zero becomes 1 when the log contained any exception/warning (printed here).
   */
  const enforceCleanExit = (childCode) => {
    if (lineBuf) scan("\n"); // flush a trailing partial line
    if (childCode === 0 && problems.length > 0) {
      log(`RUN DIRTY: ${problems.length} exception/warning line(s) in an otherwise green run:`);
      for (const p of problems) origErr(`  ✗ ${p}\n`);
      log(`failing the run — fix the cause or allowlist third-party noise in test-diagnostics.mjs`);
      process.exit(1);
    }
    process.exit(childCode ?? 1);
  };

  log(`diagnostics armed for '${suite}' → ${latestPath}`);
  return { logPath, latestPath, log, enforceCleanExit };
}
