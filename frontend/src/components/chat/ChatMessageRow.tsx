import type { ChatEntry } from "../../protocol/chatEntry";
import type { ObservableItem } from "../../utils/observableCollection";
import { useObservableValue } from "../../hooks/useObservable";
import { AssistantMessageRow } from "./rows/AssistantMessageRow";
import { ThinkingRow } from "./rows/ThinkingRow";
import { PreparedContextStep } from "./steps/PreparedContextStep";
import { ActionStep } from "./steps/ActionStep";
import { ToolRunRow } from "./rows/ToolRunRow";
import { UserMessageRow } from "./rows/UserMessageRow";

type ChatMessageRowProps = {
  entry$: ObservableItem<ChatEntry>;
  conversationId: string | null;
};

export function messageRowKey(entry$: ObservableItem<ChatEntry>): string {
  return `entry-${entry$.id}`;
}

/** Renders one ChatEntry row by `entry.type`. */
export function ChatMessageRow({ entry$, conversationId }: ChatMessageRowProps) {
  const entry = useObservableValue(entry$);
  if (entry.type === "user-message") {
    return <UserMessageRow entry={entry} />;
  }
  if (entry.type === "planner_llm_stream" || entry.type === "title_llm_stream") {
    return <ThinkingRow entry={entry} conversationId={conversationId} />;
  }
  if (entry.type === "thought-prepare") {
    return <PreparedContextStep entry={entry} />;
  }
  if (entry.type === "thought-action") {
    return <ActionStep entry={entry} />;
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
