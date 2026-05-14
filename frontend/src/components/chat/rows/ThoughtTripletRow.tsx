import { FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import { isThoughtStreamEntry, type ChatEntry, type ThoughtPrepareEntry } from "@/protocol/chatEntry";
import type { ObservableItem } from "@/utils/observableCollection";
import { useObservableValue } from "@/hooks/useObservable";
import { useChatSessionContext, type ThoughtStage } from "@/hooks/chatSessionContext";
import { ChatThreadIndent } from "../ChatMessageShell";
import { BranchBadge } from "../BranchSelector";
import { ActionStep } from "./thoughtTriplet/ActionStep";
import { ContextStep } from "./thoughtTriplet/ContextStep";
import { ReasoningStep } from "./thoughtTriplet/ReasoningStep";
import { actionMetaLabel, reasonMetaLabel } from "./thoughtTriplet/meta";
import { Connector, StepChip, TinyProgressCircle } from "./thoughtTriplet/StepChip";

type ThoughtTripletRowProps = {
  prepareEntry: ChatEntry;
  conversationId: string;
  streamEntry$?: ObservableItem<ChatEntry>;
  actionEntry?: ChatEntry | null;
};

export function ThoughtTripletRow({ prepareEntry, streamEntry$, conversationId, actionEntry }: ThoughtTripletRowProps) {
  if (prepareEntry.type !== "thought-prepare") return null;
  if (streamEntry$) {
    return (
      <ThoughtTripletRowWithStream
        prepareEntry={prepareEntry}
        streamEntry$={streamEntry$}
        conversationId={conversationId}
        actionEntry={actionEntry ?? null}
      />
    );
  }
  return <ThoughtTripletRowPrepareOnly prepareEntry={prepareEntry} />;
}

function ThoughtTripletRowWithStream({
  prepareEntry,
  streamEntry$,
  conversationId,
  actionEntry,
}: {
  prepareEntry: ThoughtPrepareEntry;
  streamEntry$: ObservableItem<ChatEntry>;
  conversationId: string;
  actionEntry: ChatEntry | null;
}) {
  const stream = useObservableValue(streamEntry$);
  const { expandedStageBySlotKey, setSlotExpandedStage } = useChatSessionContext();

  if (!isThoughtStreamEntry(stream)) return <ThoughtTripletRowPrepareOnly prepareEntry={prepareEntry} />;
  const actionStepEntry = actionEntry?.type === "thought-action" ? actionEntry : null;
  const slotKey = prepareEntry.parentId ?? stream.thoughtId;
  const expanded = expandedStageBySlotKey.get(slotKey) ?? null;
  const toggle = (stage: ThoughtStage) => setSlotExpandedStage(slotKey, expanded === stage ? null : stage);
  const contextTitle = String(prepareEntry.title ?? "").trim() || "Preparation";
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
            badge={<BranchBadge entryId={prepareEntry.id} />}
            active={expanded === "context"}
            onClick={() => toggle("context")}
          />
          <Connector />
          <StepChip
            icon={stream.status === "running" ? <TinyProgressCircle /> : <Sparkles className="h-3 w-3" />}
            label=""
            meta={reasonMeta}
            badge={<BranchBadge entryId={stream.id} />}
            active={expanded === "reasoning"}
            onClick={() => toggle("reasoning")}
          />
          <Connector />
          <StepChip
            icon={actionMeta.usesTool ? <Wrench className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            label={actionLabel}
            meta={actionMeta.status}
            badge={<BranchBadge entryId={actionStepEntry?.id} />}
            active={expanded === "action"}
            align="right"
            onClick={() => toggle("action")}
          />
        </div>

        {expanded === "context" ? <ContextStep prepareEntry={prepareEntry} stream={stream} conversationId={conversationId} /> : null}
        {expanded === "reasoning" ? <ReasoningStep stream={stream} conversationId={conversationId} /> : null}
        {expanded === "action" ? <ActionStep actionEntry={actionStepEntry} stream={stream} /> : null}
      </div>
    </ChatThreadIndent>
  );
}

function ThoughtTripletRowPrepareOnly({ prepareEntry }: { prepareEntry: ThoughtPrepareEntry }) {
  const contextTitle = String(prepareEntry.title ?? "").trim() || "Preparation";
  const noop = () => undefined;
  return (
    <ChatThreadIndent className="py-0 mb-1">
      <div className="my-0 border-l-2 border-border/60 pl-3">
        <div className="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip
            icon={<FileText className="h-3 w-3" />}
            label={contextTitle}
            badge={<BranchBadge entryId={prepareEntry.id} />}
            active={false}
            onClick={noop}
          />
          <Connector />
          <StepChip icon={<TinyProgressCircle />} label="" meta="reasoning…" active={false} onClick={noop} />
        </div>
      </div>
    </ChatThreadIndent>
  );
}
