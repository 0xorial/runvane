import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';

/**
 * Deep DB instrumentation, opt-in via RUNVANE_DB_DIAG=1 (the test harness turns
 * it on; off in production). Read-only — it changes no query behavior. Logs any
 * statement or interactive transaction slower than RUNVANE_DB_DIAG_SLOW_MS
 * (default 100ms), or everything with RUNVANE_DB_DIAG_ALL=1.
 */
const DB_DIAG = process.env.RUNVANE_DB_DIAG === '1';
const DB_DIAG_ALL = process.env.RUNVANE_DB_DIAG_ALL === '1';
const DB_DIAG_SLOW_MS = Number(process.env.RUNVANE_DB_DIAG_SLOW_MS ?? '100');

// One shared monotonic clock stamped on every diag line so SQL statements and
// transaction lifecycles can be placed on a single timeline and correlated
// (BEGIN/COMMIT are issued by Prisma outside the callback, so they can't be
// tagged with a tx id at the source — but they serialize, so end-time matches).
const CLOCK0 = performance.now();
const at = (): number => Math.round(performance.now() - CLOCK0);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly diag = new Logger('DbDiag');
  private txSeq = 0;
  private txOpen = 0;

  constructor() {
    super({
      datasources: {
        db: {
          // Fall back to the same path Prisma migrations target (resolved
          // relative to the schema at backend/prisma). Without this match, an
          // unset DATABASE_URL opens a *different*, empty DB than the one
          // migrations built — the classic "where did my data go" footgun.
          url: PrismaService.sqliteUrlWithSingleConnection(
            process.env.DATABASE_URL ?? 'file:./backend.sqlite',
          ),
        },
      },
      // Emit per-statement query events (with engine-measured duration, which
      // includes lock-wait) only when diagnostics are on.
      ...(DB_DIAG ? { log: [{ level: 'query', emit: 'event' as const }] } : {}),
    });
  }

  /**
   * Pin SQLite to a single connection. SQLite has one writer, and Prisma runs
   * each connection's calls on a bounded blocking-thread pool. Under concurrent
   * interactive transactions the waiters' `BEGIN IMMEDIATE` synchronously
   * busy-wait for the write lock, each pinning a thread; the lock holder's
   * `COMMIT` then can't get a thread to run, so it can't release the lock — a
   * pool deadlock that only breaks when a waiter hits the 5s transaction timeout
   * (P1008 / "database is locked"). One connection removes the concurrency that
   * causes it. No-op for non-file URLs or when the caller already set the param.
   */
  private static sqliteUrlWithSingleConnection(url: string): string {
    if (!url.startsWith('file:') || /[?&]connection_limit=/.test(url)) return url;
    // Configurable for the pool-size investigation; 'none' = Prisma default pool.
    const lim = process.env.RUNVANE_SQLITE_CONN_LIMIT ?? '1';
    if (lim === 'none') return url;
    return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${lim}`;
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
    // Sample Prisma's own connection-pool metrics on the shared clock. During a
    // freeze this shows directly whether connections are all busy and whether
    // queries are queued waiting for a connection (prisma_client_queries_wait).
    const metricsClient = this as unknown as {
      $metrics: { json: () => Promise<{ gauges: { key: string; value: number }[]; counters: { key: string; value: number }[] }> };
    };
    const sampler = setInterval(() => {
      metricsClient.$metrics
        .json()
        .then((m) => {
          const v = (k: string) =>
            m.gauges.find((x) => x.key === k)?.value ?? m.counters.find((x) => x.key === k)?.value ?? '?';
          this.diag.warn(
            `metrics@${at()}ms pool_open=${v('prisma_pool_connections_open')} busy=${v('prisma_pool_connections_busy')} idle=${v('prisma_pool_connections_idle')} q_active=${v('prisma_client_queries_active')} q_wait=${v('prisma_client_queries_wait')}`,
          );
        })
        .catch(() => {});
    }, 150);
    sampler.unref();

    // Per-statement timing. `e.duration` is what the engine spent, so a write
    // blocked on the SQLite writer lock shows up here as a multi-second query.
    (this as unknown as { $on: (e: 'query', cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
      'query',
      (e) => {
        if (DB_DIAG_ALL || e.duration >= DB_DIAG_SLOW_MS) {
          // end@ = when this statement finished; started at end-duration.
          this.diag.warn(`sql end@${at()}ms dur=${e.duration}ms | ${e.query.replace(/\s+/g, ' ').slice(0, 40)}`);
        }
      },
    );

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
        // (Prisma COMMIT round-trip + result delivery). acquiredAfter = BEGIN.
        const commitMs = callbackMs < 0 ? -1 : total - acquiredAfter - callbackMs;
        if (DB_DIAG_ALL || total >= DB_DIAG_SLOW_MS) {
          // begin_done@ ≈ this tx's BEGIN end-time; settle@ ≈ its COMMIT end-time.
          // Match those against the `sql end@` lines to pull its BEGIN/COMMIT.
          this.diag.warn(
            `tx#${id} begin_done@${beginDoneAt}ms settle@${at()}ms total=${total}ms begin=${acquiredAfter}ms callback=${callbackMs}ms commit=${commitMs}ms concurrentOpen=${concurrentOpen} steps=[${steps.join(' | ')}]`,
          );
        }
      });
    };
  }
}
