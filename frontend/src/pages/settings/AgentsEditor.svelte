<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import AsyncButton from "@/components/ui/AsyncButton.svelte";
  import { notifyError } from "@/utils/toast";
  import AgentColorPicker from "./AgentColorPicker.svelte";
  import AgentGuardrailSettings from "./AgentGuardrailSettings.svelte";
  import AgentIconPicker from "./AgentIconPicker.svelte";
  import AgentLlmSettings from "./AgentLlmSettings.svelte";
  import AgentPreinjectSettings from "./AgentPreinjectSettings.svelte";
  import AgentToolsSection from "./AgentToolsSection.svelte";
  import { readGuardrailConfig } from "./agentGuardrail";
  import { patchGuardrailOnAgent } from "./agentTools";
  import { readPreinjectConfig, patchPreinjectOnAgent } from "./agentPreinject";
  import { sortAgents, type ModelGroup } from "./helpers";
  import { chipActive, chipBase, chipText, ghostBtn, ghostDanger, loadError, loadHint, settingsPlaceholderBox } from "./settingsClasses";

  let {
    agents,
    presets,
    toolCatalog,
    agentEditId,
    setAgentEditId,
    currentAgent,
    setCurrentAgent,
    saveAgent,
    saveAgentAndOpenChat,
    createAgent,
    deleteLoadedAgent,
    setLoadedAgentAsDefault,
    agentLoadError,
    agentLoading,
    modelGroups,
  }: {
    agents: AgentListItemResponse[];
    presets: ModelPresetResponse[];
    toolCatalog: Record<string, unknown>[];
    agentEditId: string;
    setAgentEditId: (id: string) => void;
    currentAgent: AgentListItemResponse | null;
    setCurrentAgent: (agent: AgentListItemResponse) => void;
    saveAgent: () => Promise<boolean>;
    saveAgentAndOpenChat: (targetId?: string) => Promise<boolean>;
    createAgent: () => Promise<void>;
    deleteLoadedAgent: () => Promise<void>;
    setLoadedAgentAsDefault: () => Promise<void>;
    agentLoadError: string | null;
    agentLoading: boolean;
    modelGroups: ModelGroup[];
  } = $props();

  const canEdit = $derived(!agentLoading && !agentLoadError && currentAgent != null);

  async function handleAddAgent(): Promise<void> {
    try {
      await createAgent();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to create agent");
    }
  }

  async function handleDeleteAgent(): Promise<void> {
    if (!currentAgent) return;
    if (!window.confirm(`Delete "${currentAgent.name}"?`)) return;
    try {
      await deleteLoadedAgent();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to delete agent");
    }
  }
</script>

<div class="flex w-full min-w-0 flex-col gap-3">
  <div class="flex flex-wrap items-start gap-2.5">
    <button type="button" class={ghostBtn} onclick={() => void handleAddAgent()}>Add agent</button>
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="list" aria-label="Agents">
      {#each sortAgents(agents) as agent (agent.id)}
        <button
          type="button"
          class="{chipBase} {agent.id === agentEditId ? chipActive : ''}"
          title={agent.name}
          onclick={() => setAgentEditId(agent.id)}
        >
          <span class={chipText}>{agent.name || "Unnamed"}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="{settingsPlaceholderBox} border-solid">
    {#if agentLoading}
      <div class={loadHint}>Loading agent…</div>
    {:else}
      {#if agentLoadError}
        <div class={loadError} role="alert">Failed to load agent: {agentLoadError}</div>
      {/if}
      {#if currentAgent}
        <div class="mb-3 flex flex-wrap items-center gap-2.5">
          <AgentIconPicker
            value={currentAgent.icon}
            colorId={currentAgent.color}
            disabled={!canEdit}
            onchange={(iconId) => setCurrentAgent({ ...currentAgent, icon: iconId })}
          />
          <AgentColorPicker
            value={currentAgent.color}
            disabled={!canEdit}
            onchange={(colorId) => setCurrentAgent({ ...currentAgent, color: colorId })}
          />
          <label class="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
            Name
            <input
              type="text"
              class="ml-1.5 min-w-[140px] max-w-[420px] flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px]"
              value={currentAgent.name}
              disabled={!canEdit}
              oninput={(e) => setCurrentAgent({ ...currentAgent, name: e.currentTarget.value })}
              spellcheck={false}
              autocomplete="off"
              placeholder="Display name"
            />
          </label>
          <div class="ml-auto inline-flex flex-wrap items-center gap-2.5">
            {#if currentAgent.is_default}
              <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">default</span>
            {:else}
              <AsyncButton class={ghostBtn} disabled={!canEdit} onclick={setLoadedAgentAsDefault}>
                Set as default
              </AsyncButton>
            {/if}
            <button type="button" class="{ghostBtn} {ghostDanger}" onclick={() => void handleDeleteAgent()}>
              Delete
            </button>
            <AsyncButton class={ghostBtn} disabled={!canEdit} onclick={async () => { await saveAgent(); }}>Save</AsyncButton>
            <AsyncButton class={ghostBtn} disabled={!canEdit} onclick={async () => { await saveAgentAndOpenChat(agentEditId); }}>
              Save & chat
            </AsyncButton>
          </div>
        </div>
        <AgentLlmSettings
          agent={currentAgent}
          {canEdit}
          {modelGroups}
          {presets}
          onchange={setCurrentAgent}
        />
        <label class="mb-3 mt-3 flex flex-col gap-2 text-[13px] text-muted-foreground">
          System prompt
          <textarea
            class="min-h-[110px] w-full resize-y rounded-[10px] border border-input bg-background px-2.5 py-2 text-[13px] leading-snug"
            value={currentAgent.system_prompt}
            disabled={!canEdit}
            oninput={(e) => setCurrentAgent({ ...currentAgent, system_prompt: e.currentTarget.value })}
            spellcheck={false}
            rows={5}
          ></textarea>
        </label>
        <AgentGuardrailSettings
          config={readGuardrailConfig(currentAgent.default_llm_configuration as Record<string, unknown>)}
          {canEdit}
          {modelGroups}
          onchange={(patch) => setCurrentAgent(patchGuardrailOnAgent(currentAgent, patch))}
        />
        <AgentToolsSection
          {currentAgent}
          {toolCatalog}
          {canEdit}
          onAgentChange={setCurrentAgent}
        />
        <AgentPreinjectSettings
          config={readPreinjectConfig(currentAgent.default_llm_configuration as Record<string, unknown>)}
          {canEdit}
          onchange={(patch) => setCurrentAgent(patchPreinjectOnAgent(currentAgent, patch))}
        />
      {:else if agents.length === 0 && !agentLoadError}
        <div class={loadHint} data-testid="agents-empty-hint">
          No agents yet. An agent is a system prompt + a default model + tool permissions
          {#if modelGroups.length === 0}
            — and it needs a model, so
            <a href="/settings/model-providers" class="text-primary underline underline-offset-2">connect a provider</a>
            first (or walk the
            <a href="/chat/new?setup=1" class="text-primary underline underline-offset-2">setup guide</a>).
          {:else}
            — hit <strong>Add agent</strong> to create one.
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
