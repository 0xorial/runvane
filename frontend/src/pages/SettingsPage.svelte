<script lang="ts">
  import SettingsSidebar from "./settings/SettingsSidebar.svelte";
  import SettingsSectionView from "./settings/SettingsSectionView.svelte";
  import { parseSettingsSection, type SettingsSection } from "./settings/helpers";
  import { chatSearch, navigate } from "@/lib/router";
  import {
    createAgent as createAgentApi,
    createModelPreset,
    deleteAgentById,
    deleteModelPresetById,
    getAgentById,
    getLlmProviderSettings,
    getModelPresetById,
    getTools,
    setDefaultAgent,
    testLlmProviderConnection,
    updateAgentById,
    updateLlmProviderSettings,
    updateModelPresetById,
  } from "@/api/client";
  import type { AgentListItemResponse } from "../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../backend/src/contracts/model-presets";
  import type { LlmProviderSettingsDocument } from "../../../backend/src/contracts/settings";
  import { createAgentsQuery, createModelPresetsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import type { LlmSettings } from "@/types/llmSettings";
  import { notifyError, notifySuccess } from "@/utils/toast";

  let { sectionRaw }: { sectionRaw: string | undefined } = $props();

  const activeSection = $derived(parseSettingsSection(sectionRaw));
  const agentsQuery = createAgentsQuery();
  const presetsQuery = createModelPresetsQuery();

  let settings = $state<LlmSettings | null>(null);
  let settingsLoading = $state(true);
  let providerSearch = $state("");
  let modelFilters = $state<Record<string, string>>({});
  let collapsedModels = $state<Record<string, boolean>>({});

  let agentEditId = $state("");
  let currentAgent = $state<AgentListItemResponse | null>(null);
  let agentLoading = $state(false);
  let agentLoadError = $state<string | null>(null);
  let toolCatalog = $state<Record<string, unknown>[]>([]);

  let presetEditId = $state<number | null>(null);
  let currentPreset = $state<ModelPresetResponse | null>(null);
  let presetLoading = $state(false);
  let presetLoadError = $state<string | null>(null);

  async function loadSettings(): Promise<void> {
    settingsLoading = true;
    try {
      settings = (await getLlmProviderSettings()) as LlmSettings;
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      settingsLoading = false;
    }
  }

  async function saveProviders(): Promise<void> {
    if (!settings) return;
    await updateLlmProviderSettings(settings as unknown as LlmProviderSettingsDocument);
    queryClient.setQueryData(queryKeys.llmProviders, settings.providers);
    notifySuccess("Providers saved");
  }

  async function onTestConnection(provider: LlmSettings["providers"][number]): Promise<void> {
    const res = await testLlmProviderConnection({
      provider_id: String(provider.id || ""),
      settings: provider.settings || {},
    });
    if (!res?.ok) throw new Error(res?.detail || "Connection test failed");
    const fetchedModels = Array.isArray(res?.models) ? res.models : [];
    if (!settings) return;
    const next = structuredClone(settings);
    const idx = next.providers.findIndex((x) => x?.id === provider?.id);
    if (idx >= 0) {
      const p = next.providers[idx] as Record<string, unknown>;
      p.models = fetchedModels;
      p.models_verified = true;
    }
    settings = next;
    notifySuccess("Connection OK — models updated");
  }

  async function loadAgent(aid: string): Promise<void> {
    agentLoading = true;
    agentLoadError = null;
    currentAgent = null;
    try {
      currentAgent = await getAgentById(aid);
    } catch (e) {
      agentLoadError = e instanceof Error ? e.message : String(e);
    } finally {
      agentLoading = false;
    }
  }

  async function saveAgent(): Promise<boolean> {
    if (!currentAgent) throw new Error("No agent loaded");
    const saved = await updateAgentById(currentAgent.id, {
      name: currentAgent.name,
      system_prompt: currentAgent.system_prompt,
      default_llm_configuration: currentAgent.default_llm_configuration,
      default_model_preset_id: currentAgent.default_model_preset_id,
      icon: currentAgent.icon,
      color: currentAgent.color,
    });
    currentAgent = saved;
    await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    notifySuccess("Agent saved");
    return true;
  }

  async function saveAgentAndOpenChat(targetId?: string): Promise<boolean> {
    if (!currentAgent) throw new Error("No agent loaded");
    await saveAgent();
    const id = targetId || currentAgent.id;
    navigate(`/chat/new?agent=${encodeURIComponent(id)}`);
    return true;
  }

  async function createAgent(): Promise<void> {
    const created = await createAgentApi();
    await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    onAgentEditIdChange(created.id);
    await loadAgent(created.id);
    notifySuccess("Agent created");
  }

  async function setLoadedAgentAsDefault(): Promise<void> {
    if (!currentAgent) return;
    const updated = await setDefaultAgent(currentAgent.id);
    currentAgent = updated;
    await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
  }

  async function deleteLoadedAgent(): Promise<void> {
    if (!currentAgent) return;
    await deleteAgentById(currentAgent.id);
    await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    const remaining = agentsQuery.data ?? [];
    if (remaining.length > 0) {
      onAgentEditIdChange(remaining[0].id);
      await loadAgent(remaining[0].id);
    } else {
      onAgentEditIdChange("");
      currentAgent = null;
    }
    notifySuccess("Agent deleted");
  }

  async function loadToolCatalog(): Promise<void> {
    try {
      const rows = await getTools();
      toolCatalog = Array.isArray(rows)
        ? rows.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[]
        : [];
    } catch {
      toolCatalog = [];
    }
  }

  async function loadPreset(id: number): Promise<void> {
    presetLoading = true;
    presetLoadError = null;
    currentPreset = null;
    try {
      currentPreset = await getModelPresetById(id);
    } catch (e) {
      presetLoadError = e instanceof Error ? e.message : String(e);
    } finally {
      presetLoading = false;
    }
  }

  async function savePreset(): Promise<boolean> {
    if (!currentPreset) throw new Error("No preset loaded");
    const saved = await updateModelPresetById(currentPreset.id, {
      name: currentPreset.name,
      parameters: currentPreset.parameters,
    });
    currentPreset = saved;
    await queryClient.invalidateQueries({ queryKey: queryKeys.modelPresets });
    notifySuccess("Preset saved");
    return true;
  }

  async function createPreset(): Promise<void> {
    const created = await createModelPreset({});
    await queryClient.invalidateQueries({ queryKey: queryKeys.modelPresets });
    onPresetEditIdChange(created.id);
    await loadPreset(created.id);
    notifySuccess("Model preset created");
  }

  async function deleteLoadedPreset(): Promise<void> {
    if (!currentPreset) return;
    await deleteModelPresetById(currentPreset.id);
    await queryClient.invalidateQueries({ queryKey: queryKeys.modelPresets });
    const remaining = presetsQuery.data ?? [];
    if (remaining.length > 0) {
      onPresetEditIdChange(remaining[0].id);
      await loadPreset(remaining[0].id);
    } else {
      onPresetEditIdChange(null);
      currentPreset = null;
    }
    notifySuccess("Model preset deleted");
  }

  function goSection(section: SettingsSection): void {
    navigate(`/settings/${section}${$chatSearch}`);
  }

  function onAgentEditIdChange(id: string): void {
    agentEditId = id;
    const params = new URLSearchParams($chatSearch);
    if (id.trim()) params.set("agent", id.trim());
    else params.delete("agent");
    const q = params.toString();
    navigate(`/settings/agents${q ? `?${q}` : ""}`);
  }

  function onPresetEditIdChange(id: number | null): void {
    presetEditId = id;
    const params = new URLSearchParams($chatSearch);
    if (id != null) params.set("preset", String(id));
    else params.delete("preset");
    const q = params.toString();
    navigate(`/settings/model-presets${q ? `?${q}` : ""}`);
  }

  $effect(() => {
    void loadSettings();
  });

  $effect(() => {
    const fromUrl = new URLSearchParams($chatSearch).get("agent")?.trim() || "";
    if (fromUrl) agentEditId = fromUrl;
    const rawPreset = new URLSearchParams($chatSearch).get("preset")?.trim() || "";
    presetEditId = /^\d+$/.test(rawPreset) ? Number(rawPreset) : null;
  });

  $effect(() => {
    if (activeSection !== "agents") return;
    const agents = agentsQuery.data ?? [];
    void loadToolCatalog().then(() => {
      if (agents.length === 0) return;
      if (agentEditId && agents.some((a) => a.id === agentEditId)) return;
      onAgentEditIdChange(agents[0].id);
    });
  });

  $effect(() => {
    if (activeSection === "agents" && agentEditId) void loadAgent(agentEditId);
  });

  $effect(() => {
    if (activeSection !== "model-presets") return;
    const presets = presetsQuery.data ?? [];
    if (presets.length === 0) return;
    if (presetEditId != null && presets.some((p) => p.id === presetEditId)) return;
    onPresetEditIdChange(presets[0].id);
  });

  $effect(() => {
    if (activeSection === "model-presets" && presetEditId != null) void loadPreset(presetEditId);
  });
</script>

<section class="min-h-0 w-full flex-1 overflow-auto">
  <div class="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_minmax(0,1fr)]">
    <SettingsSidebar {activeSection} settingsSearch={$chatSearch} onNavigate={goSection} />
    <SettingsSectionView
      section={activeSection}
      {settings}
      {settingsLoading}
      {providerSearch}
      {modelFilters}
      {collapsedModels}
      onSettingsChange={(next) => (settings = next)}
      onProviderSearchChange={(value) => (providerSearch = value)}
      onModelFilterChange={(providerId, value) => (modelFilters = { ...modelFilters, [providerId]: value })}
      onCollapsedModelsChange={(providerId, collapsed) =>
        (collapsedModels = { ...collapsedModels, [providerId]: collapsed })}
      onSaveProviders={saveProviders}
      onTestConnection={onTestConnection}
      agents={agentsQuery.data ?? []}
      {agentEditId}
      onAgentEditIdChange={onAgentEditIdChange}
      {currentAgent}
      onCurrentAgentChange={(agent) => (currentAgent = agent)}
      {agentLoadError}
      {agentLoading}
      {toolCatalog}
      onSaveAgent={saveAgent}
      onSaveAgentAndOpenChat={saveAgentAndOpenChat}
      onCreateAgent={createAgent}
      onDeleteAgent={deleteLoadedAgent}
      onSetDefaultAgent={setLoadedAgentAsDefault}
      presets={presetsQuery.data ?? []}
      {presetEditId}
      onPresetEditIdChange={onPresetEditIdChange}
      {currentPreset}
      onCurrentPresetChange={(preset) => (currentPreset = preset)}
      {presetLoadError}
      {presetLoading}
      onSavePreset={savePreset}
      onCreatePreset={createPreset}
      onDeletePreset={deleteLoadedPreset}
    />
  </div>
</section>
