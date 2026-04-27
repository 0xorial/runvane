import { useState } from "react";
import { FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import type { ChatEntry } from "@/protocol/chatEntry";
import type { ObservableItem } from "@/utils/observableCollection";
import { useObservableValue } from "@/hooks/useObservable";
import { ChatThreadIndent } from "../ChatMessageShell";
import { ActionStep } from "./thoughtTriplet/ActionStep";
import { ContextStep } from "./thoughtTriplet/ContextStep";
import { ReasoningStep } from "./thoughtTriplet/ReasoningStep";
import { actionMetaLabel, reasonMetaLabel } from "./thoughtTriplet/meta";
import { Connector, StepChip, TinyProgressCircle } from "./thoughtTriplet/StepChip";

type ThoughtTripletRowProps = {
  streamEntry$: ObservableItem<ChatEntry>;
  conversationId: string | null;
  prepareEntry?: ChatEntry | null;
  actionEntry?: ChatEntry | null;
};

type ThoughtStage = "context" | "reasoning" | "action";

export function ThoughtTripletRow({ streamEntry$, conversationId, prepareEntry, actionEntry }: ThoughtTripletRowProps) {
  const stream = useObservableValue(streamEntry$);
  const [expanded, setExpanded] = useState<ThoughtStage | null>(null);

  if (stream.type !== "planner_llm_stream" && stream.type !== "title_llm_stream") return null;
  const prepareStepEntry = prepareEntry?.type === "thought-prepare" ? prepareEntry : null;
  const actionStepEntry = actionEntry?.type === "thought-action" ? actionEntry : null;
  const contextTitle = String(prepareStepEntry?.title ?? "").trim() || "Preparation";
  const reasonMeta = reasonMetaLabel(stream);
  const actionMeta = actionMetaLabel(actionStepEntry, stream);
  const actionLabel = actionMeta.usesTool ? `call ${actionMeta.toolName ?? "tool"}` : "Reply";

  return (
    <ChatThreadIndent className="py-0 mb-1">
      <div className="my-0 border-l-2 border-border/60 pl-3">
        <div className="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip
            icon={<FileText className="h-3 w-3" />}
            label={contextTitle}
            active={expanded === "context"}
            onClick={() => setExpanded((v) => (v === "context" ? null : "context"))}
          />
          <Connector />
          <StepChip
            icon={stream.status === "running" ? <TinyProgressCircle /> : <Sparkles className="h-3 w-3" />}
            label=""
            meta={reasonMeta}
            active={expanded === "reasoning"}
            onClick={() => setExpanded((v) => (v === "reasoning" ? null : "reasoning"))}
          />
          <Connector />
          <StepChip
            icon={actionMeta.usesTool ? <Wrench className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            label={actionLabel}
            meta={actionMeta.status}
            active={expanded === "action"}
            align="right"
            onClick={() => setExpanded((v) => (v === "action" ? null : "action"))}
          />
        </div>

        {expanded === "context" ? <ContextStep prepareEntry={prepareStepEntry} stream={stream} conversationId={conversationId} /> : null}
        {expanded === "reasoning" ? <ReasoningStep stream={stream} conversationId={conversationId} /> : null}
        {expanded === "action" ? <ActionStep actionEntry={actionStepEntry} stream={stream} /> : null}
      </div>
    </ChatThreadIndent>
  );
}
