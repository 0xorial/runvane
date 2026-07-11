import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Deep DB instrumentation, opt-in via RUNVANE_DB_DIAG=1 (the test harness turns
 * it on; off in production). Read-only — it changes no query behavior. Logs any
 * interactive transaction slower than RUNVANE_DB_DIAG_SLOW_MS (default 100ms),
 * or everything with RUNVANE_DB_DIAG_ALL=1.
 *
 * Prisma 7 note: the per-statement query-event log and the $metrics pool
 * sampler are gone with the Rust engine ($on('query') and the "metrics"
 * preview no longer exist); the transaction timeline below is pure JS and
 * survives. Queries now run through the better-sqlite3 driver adapter — the
 * engine-side lock-wait class the statement log was built to catch (the itx
 * RwLock deadlock, prisma/prisma#11750) no longer exists.
 */
const DB_DIAG = process.env.RUNVANE_DB_DIAG === '1';
const DB_DIAG_ALL = process.env.RUNVANE_DB_DIAG_ALL === '1';
const DB_DIAG_SLOW_MS = Number(process.env.RUNVANE_DB_DIAG_SLOW_MS ?? '100');

/**
 * Hard ceiling on how long any transaction may stay open. SQLite has no row
 * locks: an open write transaction holds the database-wide writer lock, and
 * better-sqlite3 waits for that lock synchronously — blocking the entire event
 * loop for up to busy_timeout. Batch transactions execute synchronously and so
 * cannot overstay; the only shape that can is an interactive transaction held
 * across an `await`, which is exactly the shape this repo bans.
 *
 * Verified against Prisma 7.8 (probe, 2026-07-11): `transactionOptions.timeout`
 * rolls the transaction back and releases the writer lock AT the deadline, but
 * the `$transaction` promise itself only rejects once the (possibly stuck)
 * callback settles — a callback awaiting something that never resolves would
 * never surface the error. installTxOpenGuard() closes that gap.
 */
const TX_MAX_OPEN_MS = 2_000;

// One shared monotonic clock stamped on every diag line so transaction
// lifecycles can be placed on a single timeline and correlated.
const CLOCK0 = performance.now();
const at = (): number => Math.round(performance.now() - CLOCK0);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Write straight to stdout, NOT through Nest's Logger: the diagnostics are
  // harness-facing (captured by scripts/test-diagnostics.mjs' tee), and the jest
  // TestingModule silences the Nest logger, which would swallow them.
  private readonly diag = {
    warn: (msg: string) => process.stdout.write(`[DbDiag] ${msg}\n`),
  };
  private txSeq = 0;
  private txOpen = 0;

  constructor() {
    super({
      // Driver adapter (no Rust engine). The fallback matches the path Prisma
      // migrations target. Unlike the old engine, the adapter resolves relative
      // `file:` URLs against the process cwd (backend/), not the schema dir —
      // hence `./prisma/…` where the old fallback said `./backend.sqlite`.
      adapter: new PrismaBetterSqlite3({
        url: process.env.DATABASE_URL ?? 'file:./prisma/backend.sqlite',
      }),
      // Prisma-enforced half of the TX_MAX_OPEN_MS guard: rollback + writer
      // lock release at the deadline (see the constant's doc for the probe).
      transactionOptions: { timeout: TX_MAX_OPEN_MS, maxWait: TX_MAX_OPEN_MS },
    });
    this.installTxOpenGuard();
  }

  /**
   * Always-on tripwire for the banned pattern (interactive transaction held
   * open across `await`s): rejects the caller AT the TX_MAX_OPEN_MS deadline —
   * by which point Prisma has already rolled the transaction back and released
   * SQLite's writer lock — instead of whenever the stuck callback settles.
   * Batch transactions pass through untouched: better-sqlite3 runs them
   * synchronously, so they cannot be held open across the event loop.
   */
  private installTxOpenGuard(): void {
    const orig = this.$transaction.bind(this) as (...a: unknown[]) => Promise<unknown>;
    (this as unknown as { $transaction: unknown }).$transaction = (arg: unknown, opts?: unknown) => {
      if (typeof arg !== 'function') return orig(arg, opts);
      // Captured before the work starts, so the rejection names the call site
      // that opened the transaction, not this wrapper.
      const openedHere = new Error(
        `interactive transaction open for more than ${TX_MAX_OPEN_MS}ms — Prisma has rolled it back. ` +
          'On SQLite an open write transaction holds the database-wide writer lock; do not hold a ' +
          'transaction across awaits — precompute and use a batch $transaction([...]) instead.',
      );
      return new Promise((resolve, reject) => {
        // Small grace period so Prisma's own, more specific expiry error wins
        // whenever the callback is still making (failing) progress.
        const timer = setTimeout(() => reject(openedHere), TX_MAX_OPEN_MS + 250);
        timer.unref();
        orig(arg, opts).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    };
  }

  async onModuleInit(): Promise<void> {
    if (DB_DIAG) this.installDbDiagnostics();
    await this.$connect();
    // WAL lets reads proceed alongside the single writer; busy_timeout is a
    // backstop for any brief lock wait. Persisted on the file (WAL) / set on the
    // connection (busy_timeout).
    await this.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await this.$queryRawUnsafe('PRAGMA busy_timeout=5000');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private installDbDiagnostics(): void {
    // Per-transaction timing + live concurrency + the internal statement
    // timeline (offset from tx start, and each statement's own duration). The
    // timeline is what distinguishes "held the lock while starved of loop time"
    // (fast statements with big offset gaps) from "a statement blocked" (one
    // long-duration statement). Wraps the interactive form only.
    const RAW = new Set(['$queryRawUnsafe', '$executeRawUnsafe', '$queryRaw', '$executeRaw']);
    const orig = this.$transaction.bind(this) as (...a: unknown[]) => Promise<unknown>;
    (this as unknown as { $transaction: unknown }).$transaction = (arg: unknown, opts?: unknown) => {
      if (typeof arg !== 'function') return orig(arg, opts);
      const id = ++this.txSeq;
      const t0 = performance.now();
      const concurrentOpen = ++this.txOpen;
      let acquiredAfter = -1;
      let callbackMs = -1;
      let beginDoneAt = -1;
      const steps: string[] = [];
      return orig(async (rawTx: object) => {
        acquiredAfter = Math.round(performance.now() - t0);
        beginDoneAt = at();
        const txStart = performance.now();
        const tx = new Proxy(rawTx, {
          get: (target, prop, receiver) => {
            const val = Reflect.get(target, prop, receiver);
            if (typeof val === 'function' && typeof prop === 'string' && RAW.has(prop)) {
              return (...a: unknown[]) => {
                const s = performance.now();
                const sql = String(a[0]).replace(/\s+/g, ' ').slice(0, 40);
                return Promise.resolve((val as (...x: unknown[]) => unknown).apply(target, a)).then(
                  (r) => {
                    steps.push(`+${Math.round(s - txStart)}ms(${Math.round(performance.now() - s)}ms)${sql}`);
                    return r;
                  },
                );
              };
            }
            return typeof val === 'function' ? val.bind(target) : val;
          },
        });
        const cbStart = performance.now();
        const r = await (arg as (t: unknown) => Promise<unknown>)(tx);
        callbackMs = Math.round(performance.now() - cbStart);
        return r;
      }, opts).finally(() => {
        this.txOpen -= 1;
        const total = Math.round(performance.now() - t0);
        // commitMs = time after the callback returned until the tx settled
        // (COMMIT round-trip + result delivery). acquiredAfter = BEGIN.
        const commitMs = callbackMs < 0 ? -1 : total - acquiredAfter - callbackMs;
        if (DB_DIAG_ALL || total >= DB_DIAG_SLOW_MS) {
          this.diag.warn(
            `tx#${id} begin_done@${beginDoneAt}ms settle@${at()}ms total=${total}ms begin=${acquiredAfter}ms callback=${callbackMs}ms commit=${commitMs}ms concurrentOpen=${concurrentOpen} steps=[${steps.join(' | ')}]`,
          );
        }
      });
    };
  }
}
