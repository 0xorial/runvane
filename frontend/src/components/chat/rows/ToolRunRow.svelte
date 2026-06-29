<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { approveToolInvocation, denyToolInvocation, getTools } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import type { ToolInvocationEntry } from "@/protocol/chatEntry";
  import { notifyError } from "@/utils/toast";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import Icon from "@/components/ui/Icon.svelte";

  let { entry, conversationId }: { entry: ToolInvocationEntry; conversationId: string } = $props();

  let toggled = $state<boolean | null>(null);
  let approving = $state(false);
  let denying = $state(false);
  const expanded = $derived(toggled ?? (entry.state === "requested" || entry.state === "running"));

  const toolName = $derived(entry.toolId || "tool");
  // Where this tool ran — looked up from the catalog so the row shows whether
  // the call hit the target sandbox or stayed in the harness.
  const toolsQuery = createQuery(() => ({ queryKey: queryKeys.tools, queryFn: getTools }));
  const toolLocation = $derived.by(() => {
    const row = (toolsQuery.data ?? []).find((t) => t.name === toolName);
    return row?.location === "target" || row?.location === "harness" ? row.location : null;
  });
  const locationTitle = $derived(
    toolLocation === "target" ? "Runs in the target sandbox" : "Runs in the harness sandbox",
  );
  const guardrailReason = $derived.by(() => {
    const err = entry.result?.error ?? null;
    if (!err) return null;
    const prefix = "Guardrail flagged: ";
    return err.startsWith(prefix) ? err.slice(prefix.length) : null;
  });
  const paramsText = $derived(stringifyMaybe(entry.parameters));
  const outputText = $derived(entry.result?.output != null ? stringifyMaybe(entry.result.output) : "");
  const errorText = $derived(entry.result?.error ?? "");
  // Transient live output streamed while the tool runs (see chatSessionStore).
  const liveOutput = $derived((entry as unknown as { liveOutput?: string }).liveOutput ?? "");
  const statusLabel = $derived(
    guardrailReason
      ? "Guardrail flagged"
      : entry.state === "requested"
        ? "Needs approval"
        : entry.state === "running"
          ? "Running"
          : entry.state === "done"
            ? "Done"
            : entry.state === "denied"
              ? "Denied"
              : "Failed",
  );
  const borderClass = $derived(
    entry.state === "requested"
      ? "border-warning/40 bg-warning/5"
      : entry.state === "running"
        ? "border-primary/30 bg-primary/5"
        : entry.state === "denied"
          ? "border-muted-foreground/20 bg-secondary/30"
          : "bg-secondary/50",
  );

  async function onApproveClick(): Promise<void> {
    if (!conversationId || approving || denying) return;
    approving = true;
    try {
      await approveToolInvocation(conversationId, entry.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to approve tool");
    } finally {
      approving = false;
    }
  }

  async function onDenyClick(): Promise<void> {
    if (!conversationId || approving || denying) return;
    denying = true;
    try {
      await denyToolInvocation(conversationId, entry.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to deny tool");
    } finally {
      denying = false;
    }
  }

  function stringifyMaybe(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div class="overflow-hidden rounded-md border {borderClass}" data-testid="tool-invocation-row" data-tool-state={entry.state}>
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        {#if entry.state === "running"}
          <Icon name="loader" class="h-3 w-3 shrink-0 animate-spin text-primary" />
        {:else}
          <RowIcon name="wrench" class="h-3 w-3 shrink-0 text-primary" />
        {/if}
        <span class="font-mono font-medium text-foreground">{toolName}</span>
        {#if toolLocation}
          <span
            class="rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide {toolLocation === 'target'
              ? 'bg-teal-500/15 text-teal-600'
              : 'bg-violet-500/15 text-violet-600'}"
            title={locationTitle}
            data-testid="tool-location"
            data-tool-location={toolLocation}
          >
            {toolLocation === "target" ? "target" : "harness"}
          </span>
        {/if}
        <span
          class="ml-auto text-[10px] font-medium {entry.state === 'requested'
            ? 'text-warning'
            : entry.state === 'running'
              ? 'text-primary'
              : 'text-muted-foreground'}"
        >
          {statusLabel}
        </span>
      </button>
      {#if expanded}
        <div class="animate-slide-in space-y-2 border-t px-3 py-2">
          {#if guardrailReason}
            <div class="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
              <span class="font-semibold">Guardrail:</span>
              <span>{guardrailReason}</span>
            </div>
          {/if}
          {#if entry.state === "error" && errorText}
            <div class="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <span class="font-semibold">Error:</span> {errorText}
            </div>
          {/if}
          {#if entry.state === "denied"}
            <div class="rounded-md bg-secondary/60 px-2.5 py-2 text-xs text-muted-foreground">
              <span class="font-semibold">Denied</span> — this tool was not run.
            </div>
          {/if}
          <div>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Arguments</span>
            <pre class="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{paramsText}</pre>
          </div>
          {#if entry.state === "running" && liveOutput}
            <div>
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Live output</span>
              <pre
                class="scrollbar-thin mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground"
                data-testid="tool-live-output">{liveOutput}</pre>
            </div>
          {/if}
          {#if outputText}
            <div>
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
              <pre class="scrollbar-thin mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{outputText}</pre>
            </div>
          {/if}
          {#if entry.state === "requested"}
            <div class="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="tool-approve-button"
                onclick={(e) => {
                  e.stopPropagation();
                  void onApproveClick();
                }}
                disabled={!conversationId || approving || denying}
                class="flex items-center gap-1.5 rounded-md bg-success/15 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/25 disabled:opacity-50"
              >
                {approving ? "Approving…" : "Approve & run"}
              </button>
              <button
                type="button"
                data-testid="tool-deny-button"
                onclick={(e) => {
                  e.stopPropagation();
                  void onDenyClick();
                }}
                disabled={!conversationId || approving || denying}
                class="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                {denying ? "Denying…" : "Deny"}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</ChatThreadIndent>
