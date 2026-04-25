import type { PlannerLlmStreamEntry, ThoughtPrepareEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { ReadOnlySection } from "./ReadOnlySection";

export function ContextStep({
  prepareEntry,
  stream,
}: {
  prepareEntry: ThoughtPrepareEntry | null;
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry;
}) {
  const prompt = (prepareEntry?.requestText ?? stream.llmRequest ?? "").trim();
  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="text-[10px] text-muted-foreground">
        {prepareEntry?.llmModel ? `model: ${prepareEntry.llmModel}` : stream.llmModel ? `model: ${stream.llmModel}` : "model: unknown"}
      </div>
      <ReadOnlySection label="Prompt" value={prompt} />
    </div>
  );
}
