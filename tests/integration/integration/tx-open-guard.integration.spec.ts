import { PrismaService } from '../../../backend/src/db/prisma.service';
import { retainSharedTestApp } from '../support/shared-app';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeMaybe = runLive ? describe : describe.skip;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Safety layer against "interactive transactions as locks": on SQLite an open
 * write transaction holds the database-wide writer lock, so one held across an
 * `await` stalls every write in the app. PrismaService enforces TX_MAX_OPEN_MS
 * (2s) in two halves — Prisma's transactionOptions.timeout rolls the
 * transaction back at the deadline (releasing the writer lock), and the
 * installTxOpenGuard wrapper rejects the caller at the deadline even while the
 * offending callback is still stuck mid-await.
 */
describeMaybe('transaction open-time guard (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    prisma = testApp.app.get(PrismaService);
  }, 30_000);

  it('an interactive transaction held past the deadline rejects at ~2s and releases the writer lock', async () => {
    const started = Date.now();
    await expect(
      prisma.$transaction(async (tx) => {
        // Take the writer lock, then hold the transaction across an await —
        // the exact pattern the repo bans.
        await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS tx_guard_probe (id INTEGER)');
        await sleep(5_000);
      }),
    ).rejects.toThrow(/interactive transaction open for more than/);
    // Rejected at the ~2s deadline, not at the 5s callback settle.
    expect(Date.now() - started).toBeLessThan(3_500);
    // The rollback already released the writer lock: an ordinary write goes
    // straight through while the stuck callback is still sleeping.
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS tx_guard_free (id INTEGER)');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS tx_guard_free');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS tx_guard_probe');
  }, 15_000);

  it('fast interactive and batch transactions pass through untouched', async () => {
    // The adapter surfaces SQLite integers as BigInt — normalize before comparing.
    const viaCallback = await prisma.$transaction(async (tx) => {
      const rows = (await tx.$queryRawUnsafe('SELECT 41 + 1 AS answer')) as Array<{ answer: bigint }>;
      return rows[0]!.answer;
    });
    expect(Number(viaCallback)).toBe(42);

    const [batchRows] = await prisma.$transaction([prisma.$queryRawUnsafe('SELECT 7 AS seven')]);
    expect(Number((batchRows as Array<{ seven: bigint }>)[0]!.seven)).toBe(7);
  });
});
