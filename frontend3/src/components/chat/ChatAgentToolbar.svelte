<script lang="ts">
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import {
    createAgentsQuery,
    createLlmProvidersQuery,
    createModelPresetsQuery,
  } from "@/hooks/queries/referenceData";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { buildModelGroups, sortAgents } from "@/pages/settings/helpers";
  import { pathname as pathnameStore, replacePath } from "@/lib/router";

  export type ChatAgentSelection = {
    agentId: string;
    llm: LlmRef | null;
    modelPresetId: number | null;
  };

  let {
    onSelectionChange,
    showAgent = true,
  }: {
    onSelectionChange: (selection: ChatAgentSelection) => void;
    showAgent?: boolean;
  } = $props();

  const agentsQuery = createAgentsQuery();
  const presetsQuery = createModelPresetsQuery();
  const providersQuery = createLlmProvidersQuery();

  const agents = $derived(sortAgents(agentsQuery.data ?? []));
  const presets = $derived(presetsQuery.data ?? []);
  const modelGroups = $derived(buildModelGroups(providersQuery.data ?? []));

  let selectedAgentId = $state("");
  let selectedProviderId = $state("");
  let selectedModel = $state("");
  let followAgentDefault = $state(true);
  let selectedPresetId = $state<number | null>(null);

  function readSearch(path: string): URLSearchParams {
    const q = path.indexOf("?");
    const search = q >= 0 ? path.slice(q) : "";
    return new URLSearchParams(search);
  }

  function syncUrl(agentId: string, presetId: number | null): void {
    const path = $pathnameStore;
    const params = readSearch(path);
    if (agentId.trim()) params.set("agent", agentId.trim());
    else params.delete("agent");
    if (presetId != null) params.set("preset", String(presetId));
    else params.delete("preset");
    const pathOnly = path.split("?")[0] ?? "/chat/new";
    const q = params.toString();
    replacePath(q ? `${pathOnly}?${q}` : pathOnly);
  }

  $effect(() => {
    const params = readSearch($pathnameStore);
    const rawAgent = params.get("agent")?.trim() || "";
    const rawPreset = params.get("preset")?.trim() || "";
    selectedPresetId = /^\d+$/.test(rawPreset) ? Number(rawPreset) : null;

    if (agents.length === 0) {
      selectedAgentId = "";
      return;
    }
    if (!rawAgent) {
      const fallback = agents.find((a) => a.is_default)?.id ?? agents[0]?.id ?? "";
      selectedAgentId = fallback;
      if (fallback) syncUrl(fallback, selectedPresetId);
      return;
    }
    if (agents.some((a) => a.id === rawAgent)) {
      selectedAgentId = rawAgent;
      return;
    }
    const fallback = agents[0].id;
    selectedAgentId = fallback;
    syncUrl(fallback, selectedPresetId);
  });

  const currentAgent = $derived(agents.find((a) => a.id === selectedAgentId));
  const agentDefault = $derived(getAgentLlm(currentAgent));

  $effect(() => {
    if (followAgentDefault && agentDefault.provider_id && agentDefault.model) {
      selectedProviderId = agentDefault.provider_id;
      selectedModel = agentDefault.model;
    }
  });

  const effectiveLlm = $derived.by((): LlmRef | null => {
    const pid = selectedProviderId.trim();
    const model = selectedModel.trim();
    if (!pid || !model) return null;
    return { providerId: pid, model };
  });

  $effect(() => {
    const agentId = selectedAgentId.trim();
    if (!agentId) return;
    onSelectionChange({
      agentId,
      llm: effectiveLlm,
      modelPresetId: selectedPresetId,
    });
  });

  function onAgentChange(id: string): void {
    selectedAgentId = id;
    followAgentDefault = true;
    syncUrl(id, selectedPresetId);
  }

  function onPresetChange(raw: string): void {
    selectedPresetId = /^\d+$/.test(raw) ? Number(raw) : null;
    syncUrl(selectedAgentId, selectedPresetId);
  }

  function onModelChange(providerId: string, model: string): void {
    followAgentDefault = false;
    selectedProviderId = providerId;
    selectedModel = model;
  }
</script>

{#if agentsQuery.isPending}
  <span class="text-xs text-muted-foreground">Loading agents…</span>
{:else if agents.length === 0}
  <div class="flex items-center gap-2 text-xs text-muted-foreground">
    <span>No agents configured.</span>
    <a href="/settings/agents" class="text-primary underline">Configure agents</a>
  </div>
{:else}
  <div class="relative z-10 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pr-1 text-xs scrollbar-thin">
    {#if showAgent}
      <label class="flex shrink-0 items-center gap-1 text-muted-foreground">
        <span class="inline-flex shrink-0 items-center justify-center text-muted-foreground">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
            <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
          </svg>
          <span class="sr-only">Agent</span>
        </span>
        <select
          class="min-h-[24px] max-w-[11rem] rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-foreground shadow-none hover:bg-secondary/45"
          value={selectedAgentId}
          onchange={(e) => onAgentChange(e.currentTarget.value)}
        >
          {#each agents as agent (agent.id)}
            <option value={agent.id}>{agent.name || agent.id}</option>
          {/each}
        </select>
      </label>
      <span class="h-4 w-px shrink-0 bg-border/80" aria-hidden="true"></span>
    {/if}
    <label class="flex shrink-0 items-center gap-1 text-muted-foreground">
      <span class="inline-flex shrink-0 items-center justify-center text-muted-foreground">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
          <rect width="16" height="16" x="4" y="4" rx="2" /><rect width="6" height="6" x="9" y="9" rx="1" /><path d="M15 2v2" /><path d="M15 20v2" /><path d="M2 15h2" /><path d="M2 9h2" /><path d="M20 15h2" /><path d="M20 9h2" /><path d="M9 2v2" /><path d="M9 20v2" />
        </svg>
        <span class="sr-only">Model</span>
      </span>
      <select
        class="min-h-[24px] max-w-[12rem] rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-foreground shadow-none hover:bg-secondary/45"
        value={followAgentDefault ? "__default__" : `${selectedProviderId}::${selectedModel}`}
        onchange={(e) => {
          const v = e.currentTarget.value;
          if (v === "__default__") {
            followAgentDefault = true;
            return;
          }
          const [pid, model] = v.split("::");
          onModelChange(pid, model);
        }}
      >
        {#if agentDefault.provider_id && agentDefault.model}
          <option value="__default__">{currentAgent?.name || "agent"} default ({agentDefault.model})</option>
        {/if}
        {#each modelGroups as group (group.id)}
          <optgroup label={group.label}>
            {#each group.models as model (typeof model === "string" ? model : model.value)}
              {@const value = typeof model === "string" ? model : model.value}
              {@const label = typeof model === "string" ? model : model.label}
              <option value="{group.id}::{value}">{label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <span class="h-4 w-px shrink-0 bg-border/80" aria-hidden="true"></span>
    <label class="flex shrink-0 items-center gap-1 text-muted-foreground">
      <span class="inline-flex shrink-0 items-center justify-center text-muted-foreground">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
          <path d="M10.5 6h9.75" /><path d="M10.5 12h9.75" /><path d="M10.5 18h9.75" /><path d="M3.75 6h.007" /><path d="M3.75 12h.007" /><path d="M3.75 18h.007" />
        </svg>
        <span class="sr-only">Preset</span>
      </span>
      <select
        class="min-h-[24px] max-w-[10.5rem] rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-foreground shadow-none hover:bg-secondary/45"
        value={selectedPresetId != null ? String(selectedPresetId) : ""}
        onchange={(e) => onPresetChange(e.currentTarget.value)}
      >
        <option value="">No preset</option>
        {#each presets as preset (preset.id)}
          <option value={String(preset.id)}>{preset.name || `Preset #${preset.id}`}</option>
        {/each}
      </select>
    </label>
  </div>
{/if}
