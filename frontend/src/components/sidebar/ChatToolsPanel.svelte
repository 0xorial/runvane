<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools } from "@/api/client";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { agentIdFromSearch } from "@/lib/router";
  import {
    chatToolDraftRevision,
    resetChatToolDraft,
    chatToolDraftHasOverrides,
  } from "@/lib/chatToolDraft.svelte";
  import { effectiveAgentToolMode } from "@/lib/chatToolOverrides";
  import { getToolConfigFromAgent, getToolDefaultConfig } from "@/pages/settings/agentTools";
  import HintTooltip from "@/components/ui/HintTooltip.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import ToolTriStateControl from "./ToolTriStateControl.svelte";

  const CHAT_TOOLS_HINT = "Inherited from agent, applied to the next message you send in this chat.";

  let { search }: { search: string } = $props();

  let toolFilter = $state("");

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
  const hasOverrides = $derived.by(() => {
    void $chatToolDraftRevision;
    return chatToolDraftHasOverrides();
  });
  const toolRows = $derived.by(() => {
    void $chatToolDraftRevision;
    const catalog = toolCatalog;
    const currentAgent = agent;
    if (!currentAgent) return [];
    return catalog
      .map((raw) => String(raw.name ?? "").trim())
      .filter(Boolean)
      .map((name) => {
        const catalogRow = catalog.find((raw) => String(raw.name ?? "").trim() === name);
        return {
          name,
          description: String(catalogRow?.description ?? "").trim(),
          effectiveMode: effectiveAgentToolMode(getToolConfigFromAgent(currentAgent, name)),
        };
      });
  });

  const filteredToolRows = $derived.by(() => {
    const query = toolFilter.trim().toLowerCase();
    if (!query) return toolRows;
    return toolRows.filter((row) => row.name.toLowerCase().includes(query));
  });

  function clearToolFilter(): void {
    toolFilter = "";
  }

  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !toolFilter) return;
    event.preventDefault();
    event.stopPropagation();
    clearToolFilter();
  }

  function customSeedForTool(toolName: string) {
    if (!agent) return undefined;
    const agentCfg = getToolConfigFromAgent(agent, toolName);
    const rules =
      Object.keys(agentCfg.config).length > 0 ? agentCfg.config : getToolDefaultConfig(toolCatalog, toolName);
    return {
      policy: "custom" as const,
      rules,
      guardrail: agentCfg.guardrail,
      ...(agentCfg.guardrail_system_prompt.trim()
        ? { guardrail_system_prompt: agentCfg.guardrail_system_prompt.trim() }
        : {}),
    };
  }
</script>

<section
  class="flex min-h-[8rem] max-h-[40%] shrink-0 grow-0 basis-[40%] flex-col border-t border-sidebar-border bg-sidebar"
  data-testid="chat-tools-panel"
  aria-label="Chat tools"
>
  <div class="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chat tools</span>
    <HintTooltip content={CHAT_TOOLS_HINT} side="bottom">
      <button
        type="button"
        class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:bg-secondary/60 hover:text-foreground"
        aria-label={CHAT_TOOLS_HINT}
      >
        ?
      </button>
    </HintTooltip>
    <div class="relative min-w-0 flex-1">
      <input
        type="text"
        bind:value={toolFilter}
        data-testid="chat-tools-filter"
        class="box-border w-full rounded border border-border bg-background py-0.5 pl-1.5 pr-5 font-mono text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Filter"
        aria-label="Filter tools"
        onkeydown={onFilterKeydown}
      />
      {#if toolFilter}
        <button
          type="button"
          data-testid="chat-tools-filter-clear"
          class="absolute right-0.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          aria-label="Clear filter"
          onclick={clearToolFilter}
        >
          <Icon name="x" class="h-3 w-3" />
        </button>
      {/if}
    </div>
    {#if hasOverrides}
      <button
        type="button"
        data-testid="chat-tools-reset"
        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        title="Reset all tools to agent defaults"
        onclick={() => resetChatToolDraft()}
      >
        Reset
      </button>
    {/if}
  </div>
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
    {#if !agent}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Select an agent to configure tools.</p>
    {:else if toolCatalog.length === 0}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">Loading tools…</p>
    {:else if filteredToolRows.length === 0}
      <p class="px-1 py-2 text-[11px] text-muted-foreground">No matching tools.</p>
    {:else}
      <ul class="space-y-1.5">
        {#each filteredToolRows as row (row.name)}
          <li class="flex items-center justify-between gap-2 rounded-md px-1 py-0.5">
            <div class="flex min-w-0 flex-1 items-center gap-1">
              <div class="min-w-0 truncate font-mono text-[11px] text-foreground" title={row.name}>{row.name}</div>
              {#if row.description}
                <HintTooltip content={row.description} side="top">
                  <button
                    type="button"
                    class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none text-muted-foreground ring-1 ring-border hover:bg-secondary/60 hover:text-foreground"
                    aria-label={row.description}
                  >
                    ?
                  </button>
                </HintTooltip>
              {/if}
            </div>
            <ToolTriStateControl
              toolName={row.name}
              effectiveMode={row.effectiveMode}
              agentCustomSeed={customSeedForTool(row.name)}
              {search}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
