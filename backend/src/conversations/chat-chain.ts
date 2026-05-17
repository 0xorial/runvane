/**
 * Per-conversation-run chat append cursor.
 *
 * Tracks the running tip of the chat-entry parent-pointer chain and serializes
 * concurrent appends against it. When several thoughts run in the same scope
 * (e.g. autoTitle + planner on a fresh conversation), each forward-flow append
 * acquires the chain mutex, parents at the current tip, then advances it. The
 * resulting chain stays linear instead of branching at the seed.
 *
 * Branch roots (new user message, reprocess entry points) call `setTip` once
 * to seed the chain; everything downstream must use `append`.
 */
export class ChatChain {
  private tip: string | null = null;
  private mutex: Promise<unknown> = Promise.resolve();

  setTip(entryId: string | null): void {
    this.tip = entryId;
  }

  async append<T extends { id: string }>(
    fn: (parentId: string | null) => Promise<T>,
  ): Promise<T> {
    const prev = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev.catch(() => undefined);
      const result = await fn(this.tip);
      this.tip = result.id;
      return result;
    } finally {
      release();
    }
  }
}
