import { IngestRunner } from './ingest-runner.service.js';
import type { IngestResult } from '../contracts/rag.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('IngestRunner', () => {
  function makeRunner() {
    const gates = [deferred(), deferred(), deferred()];
    const ingest = jest.fn(async (): Promise<IngestResult> => {
      const gate = gates[ingest.mock.calls.length - 1]!;
      await gate.promise;
      return { storageId: 's' } as IngestResult;
    });
    const runner = new IngestRunner(
      { ingest } as never,
      // open() → null: log writes are optional-chained, so the runner works
      // against a registry with no backing store (as in this fake).
      { getManifest: () => ({ name: 'S' }), open: () => null } as never,
      {
        run: (_spec: unknown, fn: (signal: AbortSignal, taskId: string) => Promise<IngestResult>) =>
          fn(new AbortController().signal, 'task-1'),
        setProgress: jest.fn(),
      } as never,
    );
    return { runner, ingest, gates };
  }

  it('joins concurrent requests to the in-flight run and coalesces one follow-up', async () => {
    const { runner, ingest, gates } = makeRunner();

    const first = runner.run('s', 'manual');
    expect(runner.isRunning('s')).toBe(true);
    // Both later requests join the in-flight run (same promise, no new ingest).
    expect(runner.run('s', 'watch')).toBe(first);
    expect(runner.run('s', 'watch')).toBe(first);
    expect(ingest).toHaveBeenCalledTimes(1);

    gates[0]!.resolve();
    await first;
    await flush();
    // The joined requests marked the run dirty → exactly one follow-up.
    expect(ingest).toHaveBeenCalledTimes(2);

    gates[1]!.resolve();
    await flush();
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(runner.isRunning('s')).toBe(false);
  });

  it('independent storages run in parallel without joining', async () => {
    const { runner, ingest, gates } = makeRunner();
    const a = runner.run('a', 'manual');
    const b = runner.run('b', 'manual');
    expect(a).not.toBe(b);
    expect(ingest).toHaveBeenCalledTimes(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all([a, b]);
    await flush();
    expect(ingest).toHaveBeenCalledTimes(2);
  });
});
