import { useMemo, useState } from "react";
import { ChevronDown, FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import type {
  ChatEntry,
  PlannerLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
} from "@/protocol/chatEntry";
import type { ObservableItem } from "@/utils/observableCollection";
import { useObservableValue } from "@/hooks/useObservable";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";

type ThoughtTripletRowProps = {
  streamEntry$: ObservableItem<ChatEntry>;
  prepareEntry?: ChatEntry | null;
  actionEntry?: ChatEntry | null;
};

type ThoughtStage = "context" | "reasoning" | "action";

export function ThoughtTripletRow({ streamEntry$, prepareEntry, actionEntry }: ThoughtTripletRowProps) {
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

        {expanded === "context" ? <ContextPanel prepareEntry={prepareStepEntry} stream={stream} /> : null}
        {expanded === "reasoning" ? <ReasoningPanel stream={stream} /> : null}
        {expanded === "action" ? <ActionPanel actionEntry={actionStepEntry} stream={stream} /> : null}
      </div>
    </ChatThreadIndent>
  );
}

function StepChip({
  icon,
  label,
  meta,
  active,
  align = "left",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  active: boolean;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const hasMeta = typeof meta === "string" && meta.trim().length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded px-2 py-1 transition-colors",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
        active ? "bg-secondary text-foreground" : "hover:bg-secondary/60 hover:text-foreground"
      )}
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{icon}</span>
      <span className="inline-flex min-w-0 items-center gap-1">
        {label ? <span className="truncate font-medium">{label}</span> : null}
        {hasMeta ? <span className="truncate opacity-60">{label ? `· ${meta}` : meta}</span> : null}
      </span>
      <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", active ? "rotate-180" : "")} />
    </button>
  );
}

function Connector() {
  return <span className="self-center opacity-60">→</span>;
}

function TinyProgressCircle() {
  return (
    <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />
  );
}

function ContextPanel({
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
        {prepareEntry?.llmModel
          ? `model: ${prepareEntry.llmModel}`
          : stream.llmModel
          ? `model: ${stream.llmModel}`
          : "model: unknown"}
      </div>
      <ReadOnlySection label="Prompt" value={prompt} />
    </div>
  );
}

function ReasoningPanel({ stream }: { stream: PlannerLlmStreamEntry | TitleLlmStreamEntry }) {
  const response = String(stream.llmResponse || "").trim();
  const promptTokens = stream.promptTokens ?? 0;
  const cachedPromptTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const duration = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "running";
  const statusLabel = displayStatus(stream.status ?? "running");
  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {statusLabel ? <span>status: {statusLabel}</span> : null}
        <span>prompt: {promptTokens}t</span>
        <span>cached: {cachedPromptTokens}t</span>
        <span>completion: {completionTokens}t</span>
        <span>duration: {duration}</span>
      </div>
      <ReadOnlySection label="Raw response" value={response} />
      {stream.status === "failed" || stream.status === "cancelled" ? (
        <ReadOnlySection label="Error" value={String(stream.error || "")} danger />
      ) : null}
    </div>
  );
}

function ActionPanel({
  actionEntry,
  stream,
}: {
  actionEntry: ThoughtActionEntry | null;
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry;
}) {
  const summary = String(actionEntry?.summary || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const error = String(actionEntry?.error || stream.error || "").trim();
  const parseJson = useMemo(() => {
    if (actionEntry?.parseResult) return JSON.stringify(actionEntry.parseResult, null, 2);
    if (stream.decision) return JSON.stringify(stream.decision, null, 2);
    return "";
  }, [actionEntry?.parseResult, stream.decision]);
  const statusLabel = displayStatus(actionEntry?.status ?? stream.status ?? "running");

  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="text-[10px] text-muted-foreground">
        {[
          statusLabel ? `status: ${statusLabel}` : "",
          action ? `action: ${action}` : "",
          actionEntry?.toolName ? `tool: ${actionEntry.toolName}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <ReadOnlySection label="Summary" value={summary} />
      <ReadOnlySection label="Decision JSON" value={parseJson} />
      {(actionEntry?.status === "failed" ||
        actionEntry?.status === "cancelled" ||
        stream.status === "failed" ||
        stream.status === "cancelled") &&
      error ? (
        <ReadOnlySection label="Error" value={error} danger />
      ) : null}
    </div>
  );
}

function reasonMetaLabel(stream: PlannerLlmStreamEntry | TitleLlmStreamEntry): string {
  const provider = String(stream.llmProviderId || "").trim() || "unknown-provider";
  const model = String(stream.llmModel || "").trim() || "unknown-model";
  const status = displayStatus(stream.status ?? "running");
  const promptTokens = stream.promptTokens ?? 0;
  const cachedPromptTokens = stream.cachedPromptTokens ?? 0;
  const completionTokens = stream.completionTokens ?? 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const tokenLabel = totalTokens > 0 ? `${totalTokens}t` : "";
  const durationLabel = stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "";
  return [tokenLabel, durationLabel, `${provider}/${model}`, status].filter(Boolean).join(" · ");
}

function actionMetaLabel(
  actionEntry: ThoughtActionEntry | null,
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry
): { usesTool: boolean; status: string; toolName: string | null } {
  const toolName = String(actionEntry?.toolName || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const streamToolName = stream.decision?.type === "tool-invocation" ? String(stream.decision.toolId || "").trim() : "";
  const streamTool = streamToolName.length > 0;
  const usesTool = Boolean(toolName) || action === "tool_call" || streamTool;
  return {
    usesTool,
    status: displayStatus(actionEntry?.status ?? stream.status ?? "running"),
    toolName: toolName || streamToolName || null,
  };
}

function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

function ReadOnlySection({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre
        className={cn(
          "whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px]",
          danger
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border/50 bg-muted/40 text-foreground/90"
        )}
      >
        {value}
      </pre>
    </div>
  );
}
