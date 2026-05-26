/**
 * Single-shot batch barrier: resolves once `n` distinct keys have
 * signaled. Idempotent per key — signaling the same key twice (e.g. from
 * both a success path and a generic `finally` cleanup) only counts once.
 *
 * Used to serialize "all peer thoughts have settled" before a follow-up
 * thought (e.g. planner after attachment summaries) is started, without
 * deadlocking when a peer fails mid-pipeline.
 */
export type BatchBarrier = {
  signal: (key: string) => void;
  wait: () => Promise<void>;
};

export function createBatchBarrier(n: number): BatchBarrier {
  if (n <= 0) {
    return { signal: () => {}, wait: () => Promise.resolve() };
  }
  let remaining = n;
  const signaled = new Set<string>();
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    signal: (key: string) => {
      if (signaled.has(key)) return;
      signaled.add(key);
      if (--remaining <= 0) resolve();
    },
    wait: () => promise,
  };
}
