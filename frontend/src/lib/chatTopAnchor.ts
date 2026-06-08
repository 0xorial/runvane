import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import type { ObservableItem } from "@/utils/observableCollection";

/** Last user message on the active path, or a branch-picked anchor when still on-path. */
export function resolveTopAnchorEntryId(
  conversationId: string | null,
  entries: ObservableItem<LinkedChatEntry>[],
  selectedBranchAnchorEntryId: string | null,
): string | null {
  if (!conversationId || entries.length === 0) return null;

  const branchId = selectedBranchAnchorEntryId?.trim() || "";
  if (branchId && entries.some((row$) => row$.id === branchId)) return branchId;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].get().type === "user-message") return entries[i].id;
  }
  return null;
}
