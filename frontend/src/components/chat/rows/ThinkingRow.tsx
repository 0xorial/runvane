import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "../../../protocol/chatEntry";
import { QueriedModelStep } from "../steps/QueriedModelStep";

type ThinkingRowProps = {
  entry: PlannerLlmStreamEntry | TitleLlmStreamEntry;
  conversationId: string | null;
};

export function ThinkingRow({ entry, conversationId }: ThinkingRowProps) {
  return <QueriedModelStep entry={entry} conversationId={conversationId} />;
}
