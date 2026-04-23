import type { ChatEntry } from "../../protocol/chatEntry";
import type { ObservableItem } from "../../utils/observableCollection";
import { useObservableValue } from "../../hooks/useObservable";
import { AssistantMessageRow } from "./rows/AssistantMessageRow";
import { ThoughtTripletRow } from "./rows/ThoughtTripletRow";
import { ToolRunRow } from "./rows/ToolRunRow";
import { UserMessageRow } from "./rows/UserMessageRow";

export type ThoughtTripletRefs = {
  prepareEntry?: ChatEntry;
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
export function ChatMessageRow({ entry$, conversationId: _conversationId, thoughtTripletsById }: ChatMessageRowProps) {
  const entry = useObservableValue(entry$);
  if (entry.type === "user-message") {
    return <UserMessageRow entry={entry} />;
  }
  if (entry.type === "planner_llm_stream" || entry.type === "title_llm_stream") {
    const refs = thoughtTripletsById?.get(entry.thoughtId);
    return <ThoughtTripletRow streamEntry$={entry$} prepareEntry={refs?.prepareEntry} actionEntry={refs?.actionEntry} />;
  }
  // These rows should be grouped/rendered only through ThoughtTripletRow.
  // Keep this guard for safety and emit a dev warning if filtering regresses.
  if (entry.type === "thought-prepare" || entry.type === "thought-action") {
    if (import.meta.env.DEV) {
      console.warn("[chat] thought step row reached ChatMessageRow directly; expected ThoughtTripletRow grouping", {
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
