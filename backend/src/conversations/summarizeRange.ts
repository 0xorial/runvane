import type { ChatEntry } from '../contracts/chatEntry.js';

export type SummarizeRange = {
  fromEntryId: string;
  toEntryId: string;
  fromParentId: string;
  rangeEntries: ChatEntry[];
  rangeEntryCount: number;
};

/**
 * Resolve the entries to fold + their anchor parent.
 *
 * `firstEntryToSummarize` is the inclusive start of the range; the range
 * extends through the active-chain leaf. The summary anchors as a child
 * of the entry preceding `firstEntryToSummarize`.
 *
 * The "active chain" passed in is whatever the user is currently viewing
 * (default-view-leaf lineage). Scaffolding entries (thought prepares,
 * stream entries, action entries) are filtered out of `rangeEntries` —
 * they're internal plumbing and don't belong in the summary input — but
 * the range bounds stay anchored to the original entry ids regardless of
 * type, so the link back to the unfolded sibling branch is preserved.
 */
export function resolveSummarizeRange(
  activeChain: ChatEntry[],
  firstEntryToSummarize: string,
): SummarizeRange {
  if (activeChain.length === 0) throw new Error('active chain is empty');
  const startIdx = activeChain.findIndex((e) => e.id === firstEntryToSummarize);
  if (startIdx < 0) {
    throw new Error(`firstEntryToSummarize ${firstEntryToSummarize} is not on the active chain`);
  }
  if (startIdx === 0) {
    throw new Error('cannot summarize from the very first entry of the conversation');
  }
  const parent = activeChain[startIdx - 1]!;
  const slice = activeChain.slice(startIdx);
  const visibleSlice = slice.filter(
    (e) =>
      e.type === 'user-message' ||
      e.type === 'assistant-message' ||
      e.type === 'tool-invocation' ||
      e.type === 'checkpoint-summary',
  );
  if (visibleSlice.length === 0) {
    throw new Error('summarize range contains no user-visible turns');
  }
  return {
    fromEntryId: slice[0]!.id,
    toEntryId: activeChain[activeChain.length - 1]!.id,
    fromParentId: parent.id,
    rangeEntries: visibleSlice,
    rangeEntryCount: visibleSlice.length,
  };
}
