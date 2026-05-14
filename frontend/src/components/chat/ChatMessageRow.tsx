import { isThoughtStreamEntry, type ChatEntry } from "../../protocol/chatEntry";
import type { ObservableItem } from "../../utils/observableCollection";
import { useObservableValue } from "../../hooks/useObservable";
import { AssistantMessageRow } from "./rows/AssistantMessageRow";
import { ThoughtTripletRow } from "./rows/ThoughtTripletRow";
import { ToolRunRow } from "./rows/ToolRunRow";
import { UserMessageRow } from "./rows/UserMessageRow";

export type ThoughtTripletRefs = {
  streamEntry$?: ObservableItem<ChatEntry>;
  actionEntry?: ChatEntry;
};

type ChatMessageRowProps = {
  entry$: ObservableItem<ChatEntry>;
  conversationId: string | null;
  thoughtTripletsById?: ReadonlyMap<string, ThoughtTripletRefs>;
};

export function messageRowKey(entry$: ObservableItem<ChatEntry>): string {
  return `entry-${entry$.id}`;
}

/** Renders one ChatEntry row by `entry.type`. */
export function ChatMessageRow({ entry$, conversationId, thoughtTripletsById }: ChatMessageRowProps) {
  const entry = useObservableValue(entry$);
  if (entry.type === "user-message") {
    return <UserMessageRow entry={entry} />;
  }
  // Triplets are anchored at the thought-prepare row so chat order matches
  // thought-start order rather than stream-arrival order (which can race).
  if (entry.type === "thought-prepare") {
    const refs = thoughtTripletsById?.get(entry.thoughtId);
    return (
      <ThoughtTripletRow
        prepareEntry={entry}
        streamEntry$={refs?.streamEntry$}
        conversationId={conversationId}
        actionEntry={refs?.actionEntry}
      />
    );
  }
  // Stream and action entries are rendered inside their prepare-anchored triplet.
  if (isThoughtStreamEntry(entry) || entry.type === "thought-action") {
    if (import.meta.env.DEV) {
      console.warn("[chat] thought step row reached ChatMessageRow directly; expected prepare-anchored triplet grouping", {
        entryType: entry.type,
        entryId: entry.id,
        thoughtId: entry.thoughtId,
      });
    }
    return null;
  }
  if (entry.type === "tool-invocation") {
    return <ToolRunRow entry={entry} />;
  }
  if (entry.type === "assistant-message") {
    return <AssistantMessageRow entry={entry} />;
  }
  const _exhaustive: never = entry;
  void _exhaustive;
  return null;
}
