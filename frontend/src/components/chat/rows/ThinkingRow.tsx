import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "../../../protocol/chatEntry";
import { ChatThreadIndent } from "../ChatMessageShell";
import { ThinkingItem } from "../ThinkingItem";

type ThinkingRowProps = {
  entry: PlannerLlmStreamEntry | TitleLlmStreamEntry;
  conversationId: string | null;
};

export function ThinkingRow({ entry, conversationId }: ThinkingRowProps) {
  return (
    <ChatThreadIndent>
      <ThinkingItem entry={entry} conversationId={conversationId} />
    </ChatThreadIndent>
  );
}
