<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import type { LlmSettings } from "@/types/llmSettings";
  import AgentsEditor from "./AgentsEditor.svelte";
  import GlobalModelSettingsCard from "./GlobalModelSettingsCard.svelte";
  import ModelPresetsEditor from "./ModelPresetsEditor.svelte";
  import ModelPricingEditor from "./ModelPricingEditor.svelte";
  import ProviderCard from "./ProviderCard.svelte";
  import RagStoragesSection from "./RagStoragesSection.svelte";
  import SettingsHeader from "./SettingsHeader.svelte";
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
  const showSectionHeader = $derived(
    section !== "model-providers" &&
      section !== "model-presets" &&
      section !== "model-pricing" &&
      section !== "agents" &&
      section !== "rag",
  );
</script>

<main class="flex min-w-0 flex-col gap-3.5">
  {#if showSectionHeader}
    <SettingsHeader
      activeSection={section}
      {providerSearch}
      onProviderSearchChange={section === "model-providers" ? onProviderSearchChange : undefined}
    />
  {/if}

  {#if section === "model-providers"}
    {#if settingsLoading || !settings}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {:else}
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
      <div class="flex items-center gap-2.5">
        <AsyncButton class="{ghostBtn} border-slate-300" onclick={onSaveProviders}>Save</AsyncButton>
      </div>
    {/if}
  {:else if section === "model-presets"}
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
    <ModelPricingEditor />
  {:else if section === "agents"}
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
    <div class={settingsPlaceholderBox}>
      Per-agent tool enablement and approval policy: open <strong>Agents</strong> → pick an agent →
      <strong>Tools &amp; permissions</strong>.
    </div>
  {:else if section === "rag"}
    <RagStoragesSection />
  {:else}
    <div class={settingsPlaceholderBox}>Skills UI placeholder.</div>
  {/if}
</main>
