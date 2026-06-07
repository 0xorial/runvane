<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools } from "@/api/client";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { agentIdFromSearch } from "@/lib/router";
  import {
    getChatToolDraftRevision,
    getToolDraftEntry,
    resetChatToolDraft,
    setToolDraftMode,
    chatToolDraftHasOverrides,
  } from "@/lib/chatToolDraft.svelte";
  import { effectiveAgentToolMode, explicitModeLabel } from "@/lib/chatToolOverrides";
  import { getToolConfigFromAgent, getToolDefaultConfig } from "@/pages/settings/agentTools";
  import ToolTriStateControl from "./ToolTriStateControl.svelte";

  const CHAT_TOOLS_HINT =
    "Overrides apply to the next message you send in this chat. They are saved on that user message and replayed when you switch back to this branch.";

  let {
    search,
    onOpenToolEditor,
  }: {
    search: string;
    onOpenToolEditor?: () => void;
  } = $props();

  const agentsQuery = createAgentsQuery();
  const toolsQuery = createQuery(() => ({
    queryKey: queryKeys.tools,
    queryFn: getTools,
  }));

  const agentId = $derived.by(() => {
    const fromUrl = agentIdFromSearch(search);
    if (fromUrl) return fromUrl;
    const agents = agentsQuery.data ?? [];
    return agents.find((a) => a.is_default)?.id ?? agents[0]?.id ?? "";
  });

  const agent = $derived((agentsQuery.data ?? []).find((row) => row.id === agentId) ?? null);
  const toolCatalog = $derived(toolsQuery.data ?? []);
  const draftRevision = $derived(getChatToolDraftRevision());
  const hasOverrides = $derived.by(() => {
    void draftRevision;
    return chatToolDraftHasOverrides();
  });

  function handleModeChange(toolName: string, mode: Parameters<typeof setToolDraftMode>[1]): void {
    setToolDraftMode(toolName, mode);
    if (mode === "custom") onOpenToolEditor?.();
  }
</script>

<section
  class="flex max-h-[40%] min-h-[8rem] shrink-0 flex-col border-t border-sidebar-border bg-sidebar"
  data-testid="chat-tools-panel"
  aria-label="Chat tools"
>
  <div class="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chat tools</span>
    <button
      type="button"
      class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:bg-secondary/60 hover:text-foreground"
      title={CHAT_TOOLS_HINT}
      aria-label={CHAT_TOOLS_HINT}
    >
      ?
    </button>
    <span class="ml-auto truncate text-[10px] text-muted-foreground/80">
      {hasOverrides ? "Overrides pending" : "Using agent defaults"}
    </span>
  </div>
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
    {#if !agent}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Select an agent to configure tools.</p>
    {:else if toolCatalog.length === 0}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Loading tools…</p>
    {:else}
      <ul class="space-y-1.5">
        {#key draftRevision}
        {#each toolCatalog as raw (String(raw.name ?? ""))}
          {@const name = String(raw.name ?? "").trim()}
          {#if name}
            {@const agentCfg = getToolConfigFromAgent(agent, name)}
            {@const entry = getToolDraftEntry(name)}
            {@const effectiveMode = effectiveAgentToolMode(agentCfg, getToolDefaultConfig(toolCatalog, name))}
            <li class="flex items-center justify-between gap-2 rounded-md px-1 py-0.5">
              <div class="min-w-0 flex-1">
                <div class="truncate font-mono text-[11px] text-foreground" title={name}>{name}</div>
                <div class="truncate text-[10px] text-muted-foreground">
                  {#if entry.mode === "inherit"}
                    Agent · {explicitModeLabel(effectiveMode)}
                  {:else}
                    Override · {explicitModeLabel(entry.mode)}
                  {/if}
                </div>
              </div>
              <ToolTriStateControl
                mode={entry.mode}
                {effectiveMode}
                onChange={(mode) => handleModeChange(name, mode)}
              />
            </li>
          {/if}
        {/each}
        {/key}
      </ul>
    {/if}
  </div>
  <div class="shrink-0 border-t border-sidebar-border px-2.5 py-1.5">
    <button
      type="button"
      data-testid="chat-tools-reset"
      class="w-full rounded-md px-2 py-1 text-[11px] transition-colors {hasOverrides
        ? 'text-foreground hover:bg-secondary/60'
        : 'cursor-default text-muted-foreground/50'}"
      disabled={!hasOverrides}
      onclick={() => resetChatToolDraft()}
    >
      Reset to agent defaults
    </button>
  </div>
</section>
