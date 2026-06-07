<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools } from "@/api/client";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { agentIdFromSearch } from "@/lib/router";
  import {
    getChatToolDraft,
    getToolDraftEntry,
    resetChatToolDraft,
    setToolDraftMode,
    chatToolDraftHasOverrides,
  } from "@/lib/chatToolDraft.svelte";
  import { getToolConfigFromAgent } from "@/pages/settings/agentTools";
  import ToolTriStateControl from "./ToolTriStateControl.svelte";

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
  const draft = $derived(getChatToolDraft());
  const hasOverrides = $derived(chatToolDraftHasOverrides());

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
  <div class="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-2.5 py-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chat tools</span>
    {#if !hasOverrides}
      <span class="truncate text-[10px] text-muted-foreground/80">Agent defaults</span>
    {/if}
  </div>
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
    {#if !agent}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Select an agent to configure tools.</p>
    {:else if toolCatalog.length === 0}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Loading tools…</p>
    {:else}
      <ul class="space-y-1.5">
        {#each toolCatalog as raw (String(raw.name ?? ""))}
          {@const name = String(raw.name ?? "").trim()}
          {#if name}
            {@const agentCfg = getToolConfigFromAgent(agent, name)}
            {@const entry = getToolDraftEntry(name)}
            <li class="flex items-center justify-between gap-2 rounded-md px-1 py-0.5">
              <div class="min-w-0 flex-1">
                <div class="truncate font-mono text-[11px] text-foreground" title={name}>{name}</div>
                {#if entry.mode === "inherit" && agentCfg.enabled}
                  <div class="truncate text-[10px] text-muted-foreground">Inherited</div>
                {/if}
              </div>
              <ToolTriStateControl
                mode={entry.mode}
                onChange={(mode) => handleModeChange(name, mode)}
              />
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>
  <div class="shrink-0 border-t border-sidebar-border px-2.5 py-1.5">
    <button
      type="button"
      class="w-full rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-40"
      disabled={!hasOverrides}
      onclick={() => resetChatToolDraft()}
    >
      Reset to agent defaults
    </button>
  </div>
</section>
