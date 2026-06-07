<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import type { LlmSettings } from "@/types/llmSettings";
  import AgentsEditor from "./AgentsEditor.svelte";
  import GlobalModelSettingsCard from "./GlobalModelSettingsCard.svelte";
  import ModelPresetsEditor from "./ModelPresetsEditor.svelte";
  import ModelPricingEditor from "./ModelPricingEditor.svelte";
  import ProviderCard from "./ProviderCard.svelte";
  import { buildModelGroups, filterProviders, type SettingsSection } from "./helpers";
  import { ghostBtn, settingsPlaceholderBox } from "./settingsClasses";
  import AsyncButton from "@/components/ui/AsyncButton.svelte";

  let {
    section,
    settings,
    settingsLoading,
    providerSearch,
    modelFilters,
    collapsedModels,
    onSettingsChange,
    onProviderSearchChange,
    onModelFilterChange,
    onCollapsedModelsChange,
    onSaveProviders,
    onTestConnection,
    agents,
    agentEditId,
    onAgentEditIdChange,
    currentAgent,
    onCurrentAgentChange,
    agentLoadError,
    agentLoading,
    toolCatalog,
    onSaveAgent,
    onSaveAgentAndOpenChat,
    onCreateAgent,
    onDeleteAgent,
    onSetDefaultAgent,
    presets,
    presetEditId,
    onPresetEditIdChange,
    currentPreset,
    onCurrentPresetChange,
    presetLoadError,
    presetLoading,
    onSavePreset,
    onCreatePreset,
    onDeletePreset,
  }: {
    section: SettingsSection;
    settings: LlmSettings | null;
    settingsLoading: boolean;
    providerSearch: string;
    modelFilters: Record<string, string>;
    collapsedModels: Record<string, boolean>;
    onSettingsChange: (next: LlmSettings) => void;
    onProviderSearchChange: (value: string) => void;
    onModelFilterChange: (providerId: string, value: string) => void;
    onCollapsedModelsChange: (providerId: string, collapsed: boolean) => void;
    onSaveProviders: () => Promise<void>;
    onTestConnection: (provider: LlmSettings["providers"][number]) => Promise<void>;
    agents: AgentListItemResponse[];
    agentEditId: string;
    onAgentEditIdChange: (id: string) => void;
    currentAgent: AgentListItemResponse | null;
    onCurrentAgentChange: (agent: AgentListItemResponse) => void;
    agentLoadError: string | null;
    agentLoading: boolean;
    toolCatalog: Record<string, unknown>[];
    onSaveAgent: () => Promise<boolean>;
    onSaveAgentAndOpenChat: (targetId?: string) => Promise<boolean>;
    onCreateAgent: () => Promise<void>;
    onDeleteAgent: () => Promise<void>;
    onSetDefaultAgent: () => Promise<void>;
    presets: ModelPresetResponse[];
    presetEditId: number | null;
    onPresetEditIdChange: (id: number) => void;
    currentPreset: ModelPresetResponse | null;
    onCurrentPresetChange: (preset: ModelPresetResponse) => void;
    presetLoadError: string | null;
    presetLoading: boolean;
    onSavePreset: () => Promise<boolean>;
    onCreatePreset: () => Promise<void>;
    onDeletePreset: () => Promise<void>;
  } = $props();

  const modelGroups = $derived(settings ? buildModelGroups(settings.providers) : []);
  const providerCards = $derived(settings ? filterProviders(settings.providers, providerSearch) : []);
</script>

<div class="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
  {#if section === "model-providers"}
    <h1 class="mb-3 text-lg font-semibold">Model Providers</h1>
    {#if settingsLoading || !settings}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else}
      <div class="mb-3">
        <input
          class="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          placeholder="Filter providers…"
          value={providerSearch}
          oninput={(e) => onProviderSearchChange(e.currentTarget.value)}
        />
      </div>
      <div class="flex flex-col gap-3">
        <GlobalModelSettingsCard {settings} {modelGroups} onSettingsChange={onSettingsChange} />
        {#each providerCards as provider (provider.id)}
          <ProviderCard
            provider={provider}
            {settings}
            onSettingsChange={onSettingsChange}
            testConnection={onTestConnection}
            modelFilter={modelFilters[String(provider.id)] ?? ""}
            onModelFilterChange={(value) => onModelFilterChange(String(provider.id), value)}
            collapsed={collapsedModels[String(provider.id)] ?? true}
            onCollapsedChange={(collapsed) => onCollapsedModelsChange(String(provider.id), collapsed)}
          />
        {/each}
      </div>
      <div class="mt-4">
        <AsyncButton class={ghostBtn} onclick={onSaveProviders}>Save providers</AsyncButton>
      </div>
    {/if}
  {:else if section === "model-presets"}
    <h1 class="mb-3 text-lg font-semibold">Model Presets</h1>
    <ModelPresetsEditor
      {presets}
      {presetEditId}
      setPresetEditId={onPresetEditIdChange}
      {currentPreset}
      setCurrentPreset={onCurrentPresetChange}
      loading={presetLoading}
      loadError={presetLoadError}
      createPreset={onCreatePreset}
      savePreset={onSavePreset}
      deletePreset={onDeletePreset}
    />
  {:else if section === "model-pricing"}
    <h1 class="mb-3 text-lg font-semibold">Model Pricing</h1>
    <ModelPricingEditor />
  {:else if section === "agents"}
    <h1 class="mb-3 text-lg font-semibold">Agents</h1>
    <AgentsEditor
      {agents}
      {presets}
      {toolCatalog}
      {agentEditId}
      setAgentEditId={onAgentEditIdChange}
      {currentAgent}
      setCurrentAgent={onCurrentAgentChange}
      saveAgent={onSaveAgent}
      saveAgentAndOpenChat={onSaveAgentAndOpenChat}
      createAgent={onCreateAgent}
      deleteLoadedAgent={onDeleteAgent}
      setLoadedAgentAsDefault={onSetDefaultAgent}
      {agentLoadError}
      {agentLoading}
      {modelGroups}
    />
  {:else if section === "tools"}
    <h1 class="mb-3 text-lg font-semibold">Tools</h1>
    <div class={settingsPlaceholderBox}>
      Per-agent tool enablement and approval policy: open <strong>Agents</strong> → pick an agent → configure tools below.
    </div>
  {:else}
    <h1 class="mb-3 text-lg font-semibold">Skills</h1>
    <div class={settingsPlaceholderBox}>Skills configuration coming soon.</div>
  {/if}
</div>
