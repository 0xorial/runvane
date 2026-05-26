/**
 * Per-conversation-run chat append cursor.
 *
 * Owns the parent-pointer ordering for everything appended during a single
 * run (initial message, reprocess, etc). The key invariant is **per-thought
 * contiguity**: all entries belonging to a single `thoughtId` end up linked
 * one after the other in the chain, with no foreign entries interleaved.
 *
 * Why this matters: a later reprocess of one thought re-tips the chain at
 * that thought's parent and appends a new branch. If a sibling thought's
 * tail entries were chained off this thought's body (because they happened
 * to land later in real time), they'd end up only on the abandoned branch.
 * The reprocessed view would then show the sibling as half-finished.
 *
 * Mechanism: every append carries the entry's `thoughtId` (or null for
 * thought-less entries like user/assistant/tool rows). On insert:
 *  - parent = the last entry already recorded for this thoughtId (the
 *    "thought tip"), falling back to the chain tip if this is the first
 *    entry for the thought.
 *  - if that parent already had a successor recorded in this run, splice
 *    the new entry in by reparenting the successor onto it.
 *  - the global tip advances only when we appended at the end of the
 *    chain (no successor to splice past).
 *
 * The reparent uses an externally-supplied callback so this class stays
 * free of repo dependencies. ChatChain doesn't track the DB schema; it
 * just rewrites links it knows about.
 */

export type ReparentFn = (entryId: string, newParentId: string) => Promise<void>;

export class ChatChain {
  private tip: string | null = null;
  private mutex: Promise<unknown> = Promise.resolve();
  /** thoughtId → most-recent entry id appended for that thought, this run. */
  private readonly thoughtTips = new Map<string, string>();
  /** parentId → the entry id we last appended as its direct child, this run. */
  private readonly nextChild = new Map<string, string>();
  private readonly reparent: ReparentFn;

  constructor(reparent: ReparentFn) {
    this.reparent = reparent;
  }

  setTip(entryId: string | null): void {
    this.tip = entryId;
  }

  getTip(): string | null {
    return this.tip;
  }

  async append<T extends { id: string }>(
    thoughtId: string | null,
    fn: (parentId: string | null) => Promise<T>,
  ): Promise<T> {
    const prev = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev.catch(() => undefined);
      const anchor = thoughtId !== null ? (this.thoughtTips.get(thoughtId) ?? this.tip) : this.tip;
      const successor = anchor !== null ? (this.nextChild.get(anchor) ?? null) : null;

      const result = await fn(anchor);

      if (successor !== null) {
        // We inserted in the middle: splice by reparenting the old successor onto us.
        await this.reparent(successor, result.id);
        this.nextChild.set(result.id, successor);
      } else {
        // We appended at the tail: advance the global tip.
        this.tip = result.id;
      }
      if (anchor !== null) this.nextChild.set(anchor, result.id);
      if (thoughtId !== null) this.thoughtTips.set(thoughtId, result.id);

      return result;
    } finally {
      release();
    }
  }
}
