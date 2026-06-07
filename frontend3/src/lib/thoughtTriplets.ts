import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import type { ObservableItem } from "@/utils/observableCollection";

export type ThoughtTripletRefs = {
  streamEntry$?: ObservableItem<ChatEntry>;
  actionEntry?: ChatEntry;
};

export function buildThoughtTripletsById(
  entries: ObservableItem<LinkedChatEntry>[],
): Map<string, ThoughtTripletRefs> {
  const map = new Map<string, ThoughtTripletRefs>();
  for (const entry$ of entries) {
    const entry = entry$.get();
    if (isThoughtStreamEntry(entry)) {
      const current = map.get(entry.thoughtId) ?? {};
      current.streamEntry$ = entry$;
      map.set(entry.thoughtId, current);
    } else if (entry.type === "thought-action") {
      const current = map.get(entry.thoughtId) ?? {};
      current.actionEntry = entry;
      map.set(entry.thoughtId, current);
    }
  }
  return map;
}

export function visibleTranscriptEntries(
  entries: ObservableItem<LinkedChatEntry>[],
): ObservableItem<LinkedChatEntry>[] {
  return entries.filter((entry$) => {
    const entry = entry$.get();
    return !isThoughtStreamEntry(entry) && entry.type !== "thought-action";
  });
}
