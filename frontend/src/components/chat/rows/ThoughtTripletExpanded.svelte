<script lang="ts">
  import type { ThoughtActionEntry, ThoughtPrepareEntry, ThoughtStreamEntry } from "@/protocol/chatEntry";
  import ContextStep from "./thoughtTriplet/ContextStep.svelte";
  import ReasoningStep from "./thoughtTriplet/ReasoningStep.svelte";
  import { displayStatus } from "./thoughtTriplet/meta";
  import ReadOnlySection from "./ReadOnlySection.svelte";

  let {
    stage,
    prepareEntry,
    stream,
    actionEntry,
    conversationId,
  }: {
    stage: "context" | "reasoning" | "action";
    prepareEntry: ThoughtPrepareEntry;
    stream: ThoughtStreamEntry;
    actionEntry: ThoughtActionEntry | null;
    conversationId: string;
  } = $props();
</script>

<div data-testid="thought-step-panel" data-thought-stage={stage}>
{#if stage === "context"}
  <ContextStep {prepareEntry} {stream} {conversationId} />
{:else if stage === "reasoning"}
  <ReasoningStep {stream} {prepareEntry} {conversationId} />
{:else}
  {@const summary = String(actionEntry?.summary || "").trim()}
  {@const action = String(actionEntry?.action || "").trim()}
  {@const error = String(actionEntry?.error || stream.error || "").trim()}
  {@const decision = stream.type === "planner_llm_stream" ? (stream.decision ?? null) : null}
  {@const parseJson = actionEntry?.parseResult
    ? JSON.stringify(actionEntry.parseResult, null, 2)
    : decision
      ? JSON.stringify(decision, null, 2)
      : ""}
  {@const statusLabel = displayStatus(actionEntry?.status ?? stream.status ?? "running")}
  {@const failed =
    actionEntry?.status === "failed" ||
    actionEntry?.status === "cancelled" ||
    stream.status === "failed" ||
    stream.status === "cancelled"}
  <div class="mt-1.5 ml-1 space-y-2 text-xs">
    <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <span>
        {[statusLabel ? `status: ${statusLabel}` : "", action ? `action: ${action}` : "", actionEntry?.toolName ? `tool: ${actionEntry.toolName}` : ""]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
    <ReadOnlySection label="Summary" value={summary} />
    <ReadOnlySection label="Decision JSON" value={parseJson} />
    {#if failed && error}
      <ReadOnlySection label="Error" value={error} danger />
    {/if}
  </div>
{/if}
</div>
