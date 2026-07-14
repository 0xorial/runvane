<script lang="ts">
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import ModelDropdown from "@/components/ui/ModelDropdown.svelte";
  import ModelSelector from "@/components/ui/ModelSelector.svelte";
  import {
    createAgentsQuery,
    createLlmProvidersQuery,
    createModelPresetsQuery,
  } from "@/hooks/queries/referenceData";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { buildModelGroups, sortAgents, type ModelGroup } from "@/pages/settings/helpers";
  import { pathname as pathnameStore, replacePath } from "@/lib/router";

  export type ChatAgentSelection = {
    agentId: string;
    llm: LlmRef | null;
    modelPresetId: number | null;
  };

  const AGENT_DEFAULT_MODEL_SENTINEL = "__agent_default__";
  const embeddedDropdownButtonClass =
    "min-h-[24px] rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-foreground shadow-none hover:bg-secondary/45 focus-visible:ring-1 focus-visible:ring-border";

  let {
    conversationId = null,
    pathPlannerLlm = null,
    onSelectionChange,
    showAgent = true,
  }: {
    conversationId?: string | null;
    pathPlannerLlm?: LlmRef | null;
    onSelectionChange: (selection: ChatAgentSelection) => void;
    showAgent?: boolean;
  } = $props();

  const presetsQuery = createModelPresetsQuery();
  const providersQuery = createLlmProvidersQuery();

  // Reactive, not a one-shot snapshot: the setup guide (and settings) create
  // agents while this toolbar is mounted, and the URL-sync effect below must
  // see the fresh list — a stale one "corrects" ?agent= back to an old agent.
  const agentsQuery = createAgentsQuery();
  const agents = $derived(sortAgents(agentsQuery.data ?? []));
  const agentsLoading = $derived(agentsQuery.isPending);
  const presets = $derived(presetsQuery.data ?? []);
  const allLlms = $derived(buildModelGroups(providersQuery.data ?? []));

  let selectedAgentId = $state("");
  let selectedLlm = $state<{ provider_id: string; model: string } | null>(null);
  let followAgentDefault = $state(true);
  let selectedPresetId = $state<number | null>(null);
  let lastPlannerSyncKey = $state("");

  function plannerSyncKey(
    cid: string | null,
    llm: LlmRef | null,
    agentDefault: { provider_id: string; model: string } | null,
  ): string {
    const agentPart = agentDefault ? `${agentDefault.provider_id}\0${agentDefault.model}` : "";
    if (!llm) return `${cid ?? ""}\0\0${agentPart}`;
    return `${cid ?? ""}\0${llm.providerId}\0${llm.model}\0${agentPart}`;
  }

  const agentGroups = $derived<ModelGroup[]>([
    {
      id: "agents",
      label: "",
      models: agents.map((a) => ({ value: a.id, label: a.name.trim() || a.id })),
    },
  ]);

  const presetGroups = $derived<ModelGroup[]>([
    {
      id: "presets",
      label: "",
      models: presets.map((p) => ({ value: String(p.id), label: p.name.trim() || `Preset #${p.id}` })),
    },
  ]);

  const currentAgent = $derived(agents.find((a) => a.id === selectedAgentId));
  const agentDefaultLlm = $derived(getAgentLlm(currentAgent));

  const normalizedAgentDefault = $derived.by(() => {
    const provider_id = String(agentDefaultLlm.provider_id || "").trim();
    const model = String(agentDefaultLlm.model || "").trim();
    if (provider_id && model) return { provider_id, model };
    return null;
  });

  const firstAvailableLlm = $derived.by(() => {
    for (const group of allLlms) {
      const first = group.models[0];
      if (first == null) continue;
      if (typeof first === "string") {
        const model = first.trim();
        if (!model) continue;
        return { provider_id: String(group.id || "").trim(), model };
      }
      const model = String(first.value || "").trim();
      if (!model) continue;
      return { provider_id: String(group.id || "").trim(), model };
    }
    return null;
  });

  const effectiveLlm = $derived(
    followAgentDefault
      ? (normalizedAgentDefault ?? firstAvailableLlm ?? { provider_id: "", model: "" })
      : (selectedLlm ?? firstAvailableLlm ?? { provider_id: "", model: "" }),
  );

  const modelGroupsWithAgentDefault = $derived.by((): ModelGroup[] => {
    if (!normalizedAgentDefault) return allLlms;
    const agentName = currentAgent?.name?.trim() || "agent";
    return [
      {
        id: AGENT_DEFAULT_MODEL_SENTINEL,
        label: "",
        models: [
          {
            value: AGENT_DEFAULT_MODEL_SENTINEL,
            label: `${agentName} default (${normalizedAgentDefault.model})`,
            className: "text-muted-foreground",
          },
        ],
      },
      ...allLlms,
    ];
  });

  const modelSelectorValue = $derived(
    followAgentDefault && normalizedAgentDefault ? AGENT_DEFAULT_MODEL_SENTINEL : effectiveLlm.model || "",
  );

  const showResetToAgentDefault = $derived(!followAgentDefault && normalizedAgentDefault != null);

  function readSearch(path: string): URLSearchParams {
    const q = path.indexOf("?");
    return new URLSearchParams(q >= 0 ? path.slice(q) : "");
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
    const next = q ? `${pathOnly}?${q}` : pathOnly;
    if (next !== path) replacePath(next);
  }

  $effect(() => {
    const params = readSearch($pathnameStore);
    const rawAgent = params.get("agent")?.trim() || "";
    const rawPreset = params.get("preset")?.trim() || "";
    const nextPresetId = /^\d+$/.test(rawPreset) ? Number(rawPreset) : null;
    if (selectedPresetId !== nextPresetId) selectedPresetId = nextPresetId;

    if (agents.length === 0) {
      if (selectedAgentId !== "") selectedAgentId = "";
      return;
    }
    if (!rawAgent) {
      const fallback = agents.find((a) => a.is_default)?.id ?? agents[0]?.id ?? "";
      if (selectedAgentId !== fallback) selectedAgentId = fallback;
      if (fallback) syncUrl(fallback, selectedPresetId);
      return;
    }
    if (agents.some((a) => a.id === rawAgent)) {
      if (selectedAgentId !== rawAgent) selectedAgentId = rawAgent;
      return;
    }
    const fallback = agents[0].id;
    if (selectedAgentId !== fallback) selectedAgentId = fallback;
    syncUrl(fallback, selectedPresetId);
  });

  $effect(() => {
    if (followAgentDefault) return;
    if (selectedLlm && selectedLlm.provider_id && selectedLlm.model) return;
    if (!firstAvailableLlm) return;
    if (
      selectedLlm?.provider_id === firstAvailableLlm.provider_id &&
      selectedLlm?.model === firstAvailableLlm.model
    ) {
      return;
    }
    selectedLlm = firstAvailableLlm;
  });

  $effect(() => {
    const syncKey = plannerSyncKey(conversationId, pathPlannerLlm, normalizedAgentDefault);
    if (syncKey === lastPlannerSyncKey) return;
    lastPlannerSyncKey = syncKey;

    if (!pathPlannerLlm) {
      followAgentDefault = true;
      selectedLlm = null;
      return;
    }

    const provider_id = pathPlannerLlm.providerId.trim();
    const model = pathPlannerLlm.model.trim();
    if (!provider_id || !model) return;

    const agentDefault = normalizedAgentDefault;
    if (agentDefault?.provider_id === provider_id && agentDefault.model === model) {
      followAgentDefault = true;
      selectedLlm = null;
      return;
    }

    followAgentDefault = false;
    selectedLlm = { provider_id, model };
  });

  $effect(() => {
    const agentId = selectedAgentId.trim();
    if (!agentId) return;
    const pid = effectiveLlm.provider_id.trim();
    const model = effectiveLlm.model.trim();
    onSelectionChange({
      agentId,
      llm: pid && model ? { providerId: pid, model } : null,
      modelPresetId: selectedPresetId,
    });
  });

  function setAgentIdAndUrl(id: string): void {
    selectedAgentId = id;
    followAgentDefault = true;
    selectedLlm = null;
    syncUrl(id, selectedPresetId);
  }

  function setPresetIdAndUrl(raw: string): void {
    selectedPresetId = /^\d+$/.test(raw.trim()) ? Number(raw) : null;
    syncUrl(selectedAgentId, selectedPresetId);
  }

  function handleModelChange(model: string, providerId?: string): void {
    if (model === AGENT_DEFAULT_MODEL_SENTINEL) {
      followAgentDefault = true;
      selectedLlm = null;
      return;
    }
    followAgentDefault = false;
    selectedLlm = {
      provider_id: providerId
        ? String(providerId)
        : String(
            effectiveLlm.provider_id ||
              normalizedAgentDefault?.provider_id ||
              firstAvailableLlm?.provider_id ||
              "",
          ).trim(),
      model,
    };
  }

  function resetToAgentDefault(): void {
    followAgentDefault = true;
    selectedLlm = null;
  }
</script>

{#if agentsLoading}
  <span class="text-xs text-muted-foreground">Loading agents…</span>
{:else if agents.length === 0}
  <div class="flex items-center gap-2 text-xs text-muted-foreground">
    <span>No agents configured.</span>
    <a href="/chat/new?setup=1" class="text-primary underline">Set up runvane</a>
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
        <div class="min-w-[96px] max-w-[11rem]">
          <ModelDropdown
            value={selectedAgentId}
            onChange={(id) => setAgentIdAndUrl(id)}
            groups={agentGroups}
            placeholder="Select agent"
            searchPlaceholder="Search agent"
            buttonClass={embeddedDropdownButtonClass}
          >
            {#snippet footer()}
              <a href="/settings/agents" class="text-primary underline-offset-4 hover:underline">Configure agents ↗</a>
            {/snippet}
          </ModelDropdown>
        </div>
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
      <div class="flex min-w-[104px] max-w-[12rem] items-center">
        <div class="min-w-0 flex-1">
          <ModelSelector
            value={modelSelectorValue}
            onChange={handleModelChange}
            modelGroups={modelGroupsWithAgentDefault}
            placeholder="Select model"
            searchPlaceholder="Search model"
            buttonClass={embeddedDropdownButtonClass}
          >
            {#snippet footer()}
              <a href="/settings/model-presets" class="text-primary underline-offset-4 hover:underline">Model configurations ↗</a>
            {/snippet}
          </ModelSelector>
        </div>
        {#if showResetToAgentDefault}
          <button
            type="button"
            title="Reset to {currentAgent?.name?.trim() || 'agent'} default"
            class="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              resetToAgentDefault();
            }}
          >
            <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 16" /><path d="M16 16h5v5" />
            </svg>
            <span class="sr-only">Reset to agent default</span>
          </button>
        {/if}
      </div>
    </label>
    <span class="h-4 w-px shrink-0 bg-border/80" aria-hidden="true"></span>
    <label class="flex shrink-0 items-center gap-1 text-muted-foreground">
      <span class="inline-flex shrink-0 items-center justify-center text-muted-foreground">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" aria-hidden="true">
          <path d="M10.5 6h9.75" /><path d="M10.5 12h9.75" /><path d="M10.5 18h9.75" /><path d="M3.75 6h.007" /><path d="M3.75 12h.007" /><path d="M3.75 18h.007" />
        </svg>
        <span class="sr-only">Preset</span>
      </span>
      <div class="min-w-[92px] max-w-[10.5rem]">
        <ModelDropdown
          value={selectedPresetId != null ? String(selectedPresetId) : ""}
          onChange={(id) => setPresetIdAndUrl(id)}
          groups={presetGroups}
          placeholder="No preset"
          searchPlaceholder="Search preset"
          buttonClass={embeddedDropdownButtonClass}
        >
          {#snippet footer()}
            <a href="/settings/model-presets" class="text-primary underline-offset-4 hover:underline">Configure presets ↗</a>
          {/snippet}
        </ModelDropdown>
      </div>
    </label>
  </div>
{/if}
