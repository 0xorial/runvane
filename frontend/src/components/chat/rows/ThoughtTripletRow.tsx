import type { ReactNode } from "react";
import { FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import { isThoughtStreamEntry, type ChatEntry, type ThoughtPrepareEntry, type ThoughtStreamEntry } from "@/protocol/chatEntry";
import type { ObservableItem } from "@/utils/observableCollection";
import { useObservableValue } from "@/hooks/useObservable";
import { useChatSessionContext, type ThoughtStage } from "@/hooks/chatSessionContext";
import { usePricingMap } from "@/hooks/usePricingMap";
import { ChatThreadIndent } from "../ChatMessageShell";
import { ActionStep } from "./thoughtTriplet/ActionStep";
import { ContextStep } from "./thoughtTriplet/ContextStep";
import { ReasoningStep } from "./thoughtTriplet/ReasoningStep";
import { actionMetaLabel, displayStatus } from "./thoughtTriplet/meta";
import { Connector, StepChip, TinyProgressCircle } from "./thoughtTriplet/StepChip";
import { TokenTooltip } from "@/components/ui/TokenTooltip";
import { formatTokenCount } from "@/utils/formatTokenCount";
import type { ModelPricing } from "@/lib/costEstimation";

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
  const pricingByModel = usePricingMap();

  if (!isThoughtStreamEntry(stream)) return <ThoughtTripletRowPrepareOnly prepareEntry={prepareEntry} />;
  const actionStepEntry = actionEntry?.type === "thought-action" ? actionEntry : null;
  const slotKey = prepareEntry.parentId ?? stream.thoughtId;
  const expanded = expandedStageBySlotKey.get(slotKey) ?? null;
  const toggle = (stage: ThoughtStage) => setSlotExpandedStage(slotKey, expanded === stage ? null : stage);
  const contextTitle = String(prepareEntry.title ?? "").trim() || "Preparation";
  const modelLabel = String(stream.llmModel || "").trim();
  const reasonMeta = buildReasonMetaNode(stream, pricingByModel.get(modelLabel));
  const actionMeta = actionMetaLabel(actionStepEntry, stream);
  const actionLabel = actionMeta.usesTool ? `call ${actionMeta.toolName ?? "tool"}` : "Reply";

  return (
    <ChatThreadIndent className="py-0 mb-1">
      <div className="my-0 border-l-2 border-border/60 pl-3">
        <div className="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip
            icon={<FileText className="h-3 w-3" />}
            label={contextTitle}
            badge={null}
            active={expanded === "context"}
            onClick={() => toggle("context")}
          />
          <Connector />
          <StepChip
            icon={stream.status === "running" ? <TinyProgressCircle /> : <Sparkles className="h-3 w-3" />}
            label=""
            meta={reasonMeta}
            badge={null}
            active={expanded === "reasoning"}
            onClick={() => toggle("reasoning")}
          />
          <Connector />
          <StepChip
            icon={actionMeta.usesTool ? <Wrench className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            label={actionLabel}
            meta={actionMeta.status}
            badge={null}
            active={expanded === "action"}
            align="right"
            onClick={() => toggle("action")}
          />
        </div>

        {expanded === "context" ? <ContextStep prepareEntry={prepareEntry} stream={stream} conversationId={conversationId} /> : null}
        {expanded === "reasoning" ? <ReasoningStep stream={stream} prepareEntry={prepareEntry} conversationId={conversationId} /> : null}
        {expanded === "action" ? <ActionStep actionEntry={actionStepEntry} stream={stream} /> : null}
      </div>
    </ChatThreadIndent>
  );
}

function buildReasonMetaNode(stream: ThoughtStreamEntry, pricing: ModelPricing | undefined): ReactNode {
  const provider = String(stream.llmProviderId || "").trim() || "unknown-provider";
  const model = String(stream.llmModel || "").trim() || "unknown-model";
  const status = displayStatus(stream.status ?? "running");
  const promptTokens = stream.promptTokens ?? 0;
  const cachedTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const totalTokens = promptTokens + cachedTokens + completionTokens;
  const durationLabel = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "";

  const parts: ReactNode[] = [];
  if (totalTokens > 0) {
    parts.push(
      <TokenTooltip key="tok" promptTokens={promptTokens} cachedTokens={cachedTokens} completionTokens={completionTokens} pricing={pricing}>
        {formatTokenCount(totalTokens)}
      </TokenTooltip>,
    );
  }
  if (durationLabel) parts.push(durationLabel);
  parts.push(`${provider}/${model}`);
  if (status) parts.push(status);

  return (
    <>
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable order
        <span key={i}>{i > 0 ? " · " : ""}{part}</span>
      ))}
    </>
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
            badge={null}
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
