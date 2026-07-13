<script lang="ts">
  import type { ThoughtEntry } from "@/protocol/chatEntry";
  import ContextStep from "./thought/ContextStep.svelte";
  import ReasoningStep from "./thought/ReasoningStep.svelte";
  import { displayStatus } from "./thought/meta";
  import ReadOnlySection from "./ReadOnlySection.svelte";

  let {
    stage,
    entry,
    conversationId,
  }: {
    stage: "context" | "reasoning" | "action";
    entry: ThoughtEntry;
    conversationId: string;
  } = $props();
</script>

<div data-testid="thought-step-panel" data-thought-stage={stage}>
{#if stage === "context"}
  <ContextStep {entry} {conversationId} />
{:else if stage === "reasoning"}
  <ReasoningStep {entry} {conversationId} />
{:else}
  {@const summary = String(entry.summary || "").trim()}
  {@const action = String(entry.action || "").trim()}
  {@const error = String(entry.error || "").trim()}
  {@const decision = entry.thoughtType === "planner" ? (entry.decision ?? null) : null}
  {@const parseJson = entry.parseResult
    ? JSON.stringify(entry.parseResult, null, 2)
    : decision
      ? JSON.stringify(decision, null, 2)
      : ""}
  {@const statusLabel = displayStatus(entry.status)}
  {@const failed = entry.status === "failed" || entry.status === "cancelled"}
  <div class="mt-1.5 ml-1 space-y-2 text-xs">
    <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <span>
        {[statusLabel ? `status: ${statusLabel}` : "", action ? `action: ${action}` : "", entry.toolName ? `tool: ${entry.toolName}` : ""]
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
