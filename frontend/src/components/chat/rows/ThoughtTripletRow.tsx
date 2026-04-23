import { useMemo, useState } from "react";
import { ChevronDown, FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import type { ChatEntry, PlannerLlmStreamEntry, ThoughtActionEntry, ThoughtPrepareEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
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
            label="Reason"
            meta={reasonMeta}
            active={expanded === "reasoning"}
            onClick={() => setExpanded((v) => (v === "reasoning" ? null : "reasoning"))}
          />
          <Connector />
          <StepChip
            icon={actionMeta.usesTool ? <Wrench className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            label={actionMeta.usesTool ? "Tool" : "Reply"}
            meta={actionMeta.status}
            active={expanded === "action"}
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) {
  const hasMeta = typeof meta === "string" && meta.trim().length > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 py-1 transition-colors",
        active ? "bg-secondary text-foreground" : "hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {hasMeta ? <span className="truncate opacity-60">· {meta}</span> : null}
      <ChevronDown className={cn("h-3 w-3 opacity-60 transition-transform", active ? "rotate-180" : "")} />
    </button>
  );
}

function Connector() {
  return <span className="self-center opacity-30">→</span>;
}

function TinyProgressCircle() {
  return <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />;
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
        {prepareEntry?.llmModel ? `model: ${prepareEntry.llmModel}` : stream.llmModel ? `model: ${stream.llmModel}` : "model: unknown"}
      </div>
      <ReadOnlySection label="Prompt" value={prompt} />
    </div>
  );
}

function ReasoningPanel({ stream }: { stream: PlannerLlmStreamEntry | TitleLlmStreamEntry }) {
  const response = String(stream.llmResponse || "").trim();
  const promptTokens = typeof stream.promptTokens === "number" && Number.isFinite(stream.promptTokens) ? stream.promptTokens : 0;
  const cachedPromptTokens =
    typeof stream.cachedPromptTokens === "number" && Number.isFinite(stream.cachedPromptTokens) ? stream.cachedPromptTokens : 0;
  const completionTokens =
    typeof stream.completionTokens === "number" && Number.isFinite(stream.completionTokens) ? stream.completionTokens : 0;
  const duration = typeof stream.thoughtMs === "number" && Number.isFinite(stream.thoughtMs) ? `${Math.round(stream.thoughtMs)}ms` : "running";
  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>status: {stream.status ?? "running"}</span>
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

  return (
    <div className="mt-1.5 ml-1 space-y-2 text-xs">
      <div className="text-[10px] text-muted-foreground">
        status: {actionEntry?.status ?? stream.status ?? "running"}
        {action ? ` · action: ${action}` : ""}
        {actionEntry?.toolName ? ` · tool: ${actionEntry.toolName}` : ""}
      </div>
      <ReadOnlySection label="Summary" value={summary} />
      <ReadOnlySection label="Decision JSON" value={parseJson} />
      {(actionEntry?.status === "failed" || actionEntry?.status === "cancelled" || stream.status === "failed" || stream.status === "cancelled") && error ? (
        <ReadOnlySection label="Error" value={error} danger />
      ) : null}
    </div>
  );
}

function reasonMetaLabel(stream: PlannerLlmStreamEntry | TitleLlmStreamEntry): string {
  const model = String(stream.llmModel || "").trim() || "unknown model";
  const status = stream.status ?? "running";
  return `${status} · ${model}`;
}

function actionMetaLabel(
  actionEntry: ThoughtActionEntry | null,
  stream: PlannerLlmStreamEntry | TitleLlmStreamEntry,
): { usesTool: boolean; status: string } {
  const toolName = String(actionEntry?.toolName || "").trim();
  const action = String(actionEntry?.action || "").trim();
  const streamTool = stream.decision?.type === "tool-invocation";
  const usesTool = Boolean(toolName) || action === "tool_call" || streamTool;
  return { usesTool, status: actionEntry?.status ?? stream.status ?? "running" };
}

function ReadOnlySection({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre
        className={cn(
          "whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px]",
          danger ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border/50 bg-muted/40 text-foreground/90",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
