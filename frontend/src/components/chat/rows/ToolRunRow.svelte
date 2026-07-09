<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { approveToolInvocation, denyToolInvocation, getTools } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import type { ToolInvocationEntry } from "@/protocol/chatEntry";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { formatDurationMs } from "@/utils/formatDurationMs";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import { notifyError } from "@/utils/toast";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import CollapsibleBlock from "@/components/ui/CollapsibleBlock.svelte";
  import Icon from "@/components/ui/Icon.svelte";

  let { entry, conversationId }: { entry: ToolInvocationEntry; conversationId: string } = $props();

  const session = getChatSessionContext();
  let toggled = $state<boolean | null>(null);
  let approving = $state(false);
  let denying = $state(false);
  let editingParams = $state(false);
  let paramsDraft = $state("");
  let paramsError = $state<string | null>(null);
  const expanded = $derived(toggled ?? (entry.state === "requested" || entry.state === "running"));
  // Terminal runs collapse to a dimmed one-liner; full details live in the
  // right-hand panel (click to open). Active runs keep the full card.
  const terminal = $derived(entry.state === "done" || entry.state === "denied" || entry.state === "error");
  const detailOpen = $derived(session.getOpenDetailEntryId() === entry.id);
  const elapsedLabel = $derived.by(() => {
    const ms = entry.result?.timing?.elapsed_ms;
    return typeof ms === "number" ? formatDurationMs(ms) : "";
  });
  const createdStamp = $derived(formatRelativeChatTime(entry.createdAt));
  const createdExact = $derived(formatExactChatTime(entry.createdAt));

  // The stored parameters payload carries planner bookkeeping; the user edits
  // (and reads) only the real tool params.
  const cleanParams = $derived.by(() => {
    const { tool_request, source, __tool_batch, ...params } = entry.parameters as Record<string, unknown>;
    void tool_request; void source; void __tool_batch;
    return params;
  });

  function startEditParams(): void {
    paramsDraft = JSON.stringify(cleanParams, null, 2);
    paramsError = null;
    editingParams = true;
  }

  /** Returns the edited params when valid and actually different, undefined
   *  when unchanged, or null when the draft isn't valid JSON. */
  function editedParamsForApprove(): Record<string, unknown> | undefined | null {
    if (!editingParams) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(paramsDraft);
    } catch (e) {
      paramsError = `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      paramsError = "Parameters must be a JSON object.";
      return null;
    }
    const edited = parsed as Record<string, unknown>;
    return JSON.stringify(edited) === JSON.stringify(cleanParams) ? undefined : edited;
  }

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
  const paramsText = $derived(stringifyMaybe(cleanParams));
  const outputText = $derived(entry.result?.output != null ? stringifyMaybe(entry.result.output) : "");
  // Transient live output streamed while the tool runs (see chatSessionStore).
  const liveOutput = $derived((entry as unknown as { liveOutput?: string }).liveOutput ?? "");
  // Terminal states show their outcome plainly (the guardrail reason lives in
  // the details panel); only a pending approval leads with the guardrail flag.
  const statusLabel = $derived(
    entry.state === "requested"
      ? guardrailReason
        ? "Guardrail flagged"
        : "Needs approval"
      : entry.state === "resolving"
        ? "Resolving arguments"
        : entry.state === "running"
          ? "Running"
          : entry.state === "done"
            ? "Done"
            : entry.state === "denied"
              ? "Denied"
              : "Failed",
  );
  // Card styling for the two active looks (terminal states render the
  // collapsed one-liner instead, never the card).
  const borderClass = $derived(
    entry.state === "requested" ? "border-warning/40 bg-warning/5" : "border-primary/30 bg-primary/5",
  );

  async function onApproveClick(): Promise<void> {
    if (!conversationId || approving || denying) return;
    const edited = editedParamsForApprove();
    if (edited === null) return; // invalid draft — error shown inline
    approving = true;
    try {
      await approveToolInvocation(conversationId, entry.id, edited);
      editingParams = false;
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

<ChatThreadIndent class={terminal ? "py-0" : ""}>
  {#snippet children()}
    {#if terminal}
      <!-- Compact view: one dimmed line; clicking it opens the details panel. -->
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-3 py-0.5 text-left text-[11px] transition-colors hover:bg-secondary/60 {detailOpen
          ? 'bg-secondary/70 text-foreground'
          : 'text-muted-foreground/70 hover:text-muted-foreground'}"
        data-testid="tool-invocation-row"
        data-tool-state={entry.state}
        data-collapsed="true"
        title="Show details"
        onclick={() => session.toggleEntryDetail(entry.id)}
      >
        {#if entry.state === "error"}
          <RowIcon name="alert" class="h-3 w-3 shrink-0 opacity-70" />
        {:else}
          <RowIcon name="wrench" class="h-3 w-3 shrink-0 opacity-50" />
        {/if}
        <span class="truncate font-mono">{toolName}</span>
        {#if entry.parametersEdited}
          <span
            class="rounded bg-warning/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-warning/80"
            title="Parameters were edited by the user before approval — the executed call differs from what the model requested"
            data-testid="tool-edited-badge"
          >
            edited
          </span>
        {/if}
        {#if (entry.attempt ?? 1) > 1}
          <span
            class="rounded bg-primary/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-primary/80"
            title="This tool was retried — {entry.attempt} execution attempts so far"
            data-testid="tool-attempt-badge"
          >
            attempt {entry.attempt}
          </span>
        {/if}
        {#if toolLocation}
          <span
            class="rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide opacity-70 {toolLocation === 'target'
              ? 'bg-teal-500/10 text-teal-600'
              : 'bg-violet-500/10 text-violet-600'}"
            title={locationTitle}
            data-testid="tool-location"
            data-tool-location={toolLocation}
          >
            {toolLocation === "target" ? "target" : "harness"}
          </span>
        {/if}
        <span class="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px]">
          {#if elapsedLabel}<span>{elapsedLabel}</span>{/if}
          <span class={entry.state === "error" ? "text-destructive/80" : ""}>{statusLabel}</span>
          {#if createdStamp}<span class="opacity-70" title={createdExact}>{createdStamp}</span>{/if}
        </span>
      </button>
    {:else}
    <div class="overflow-hidden rounded-md border {borderClass}" data-testid="tool-invocation-row" data-tool-state={entry.state}>
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        {#if entry.state === "running" || entry.state === "resolving"}
          <Icon name="loader" class="h-3 w-3 shrink-0 animate-spin text-primary" />
        {:else}
          <RowIcon name="wrench" class="h-3 w-3 shrink-0 text-primary" />
        {/if}
        <span class="font-mono font-medium text-foreground">{toolName}</span>
        {#if entry.parametersEdited}
          <span
            class="rounded bg-warning/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-warning"
            title="Parameters were edited by the user before approval — the executed call differs from what the model requested"
            data-testid="tool-edited-badge"
          >
            edited
          </span>
        {/if}
        {#if (entry.attempt ?? 1) > 1}
          <!-- A retry that re-fails in milliseconds would otherwise leave the
               row looking untouched; the counter makes each attempt visible. -->
          <span
            class="rounded bg-primary/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-primary"
            title="This tool was retried — {entry.attempt} execution attempts so far"
            data-testid="tool-attempt-badge"
          >
            attempt {entry.attempt}
          </span>
        {/if}
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
            : entry.state === 'running' || entry.state === 'resolving'
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
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                {entry.parametersEdited ? "Arguments (edited by you)" : "Arguments"}
              </span>
              {#if entry.state === "requested" && !editingParams}
                <button
                  type="button"
                  class="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  data-testid="tool-edit-params"
                  onclick={(e) => {
                    e.stopPropagation();
                    startEditParams();
                  }}
                >
                  Edit
                </button>
              {/if}
            </div>
            {#if editingParams && entry.state === "requested"}
              <textarea
                class="mt-1 min-h-[96px] w-full resize-y rounded border border-warning/40 bg-background p-2 font-mono text-xs text-secondary-foreground"
                data-testid="tool-params-editor"
                bind:value={paramsDraft}
                oninput={() => (paramsError = null)}
              ></textarea>
              {#if paramsError}
                <div class="mt-1 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" data-testid="tool-params-error">{paramsError}</div>
              {/if}
            {:else}
              <CollapsibleBlock class="mt-1">
                <pre class="overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{paramsText}</pre>
              </CollapsibleBlock>
            {/if}
          </div>
          {#if entry.parametersEdited && entry.originalParameters}
            <div>
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Original arguments (as requested by the model)</span>
              <pre class="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs text-muted-foreground" data-testid="tool-original-params">{stringifyMaybe(entry.originalParameters)}</pre>
            </div>
          {/if}
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
    {/if}
  {/snippet}
</ChatThreadIndent>
