import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AgentListItemResponse } from "../../../backend/src/contracts/agents";
import type { LlmProviderSettingsDocument } from "../../../backend/src/contracts/settings";
import type { ModelPresetResponse } from "../../../backend/src/contracts/model-presets";
import {
  createAgent as createAgentApi,
  createModelPreset,
  deleteAgentById,
  setDefaultAgent,
  deleteModelPresetById,
  getAgentById,
  getLlmProviderSettings,
  getTools as getToolsApi,
  getModelPresetById,
  testLlmProviderConnection,
  updateAgentById,
  updateModelPresetById,
  updateLlmProviderSettings,
} from "../api/client";
import { AsyncButton } from "../components/ui/AsyncButton";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "@/lib/utils";
import { AgentsEditor } from "./settings/AgentsEditor";
import { GlobalModelSettingsCard } from "./settings/GlobalModelSettingsCard";
import { ModelPresetsEditor } from "./settings/ModelPresetsEditor";
import { ModelPricingEditor } from "./settings/ModelPricingEditor";
import { filterProviders, parseSettingsSection, buildModelGroups } from "./settings/helpers";
import type { LlmSettings } from "../types/llmSettings";
import { useLlmSettings } from "../hooks/llmSettingsContext";
import { refreshAgents, refreshModelPresets } from "../hooks/queries/invalidate";
import { useAgentsQuery, useModelPresetsQuery } from "../hooks/queries/referenceData";
import { ProviderCard } from "./settings/ProviderCard";
import { SettingsHeader } from "./settings/SettingsHeader";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { ghostBtn, settingsPlaceholderBox } from "./settings/settingsClasses";
import { notifyToast } from "../utils/toast";

function ToolsSettingsPlaceholder() {
  return (
    <div className={settingsPlaceholderBox}>
      Per-agent tool enablement and approval policy: open <strong>Agents</strong> → pick an agent →{" "}
      <strong>Tools &amp; permissions</strong>.
    </div>
  );
}

export function SettingsPage() {
  const { setProviders: setGlobalProviders } = useLlmSettings();
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [search, setSearch] = useState("");
  const [modelFilters, setModelFilters] = useState<Record<string, string>>({});
  const [collapsedModels, setCollapsedModels] = useState<Record<string, boolean>>({});
  const [searchParams, setSearchParams] = useSearchParams();

  const agentEditId = searchParams.get("agent")?.trim() || "";
  function setAgentEditId(nextId: string) {
    const t = nextId.trim();
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!t) n.delete("agent");
        else n.set("agent", t);
        return n;
      },
      { replace: true },
    );
  }

  const { data: agents = [] } = useAgentsQuery();
  const [currentAgent, setCurrentAgent] = useState<AgentListItemResponse | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null);
  const presetEditIdRaw = searchParams.get("preset")?.trim() || "";
  const presetEditId = /^\d+$/.test(presetEditIdRaw) ? Number(presetEditIdRaw) : null;
  function setPresetEditId(nextId: number | null) {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (nextId == null) n.delete("preset");
        else n.set("preset", String(nextId));
        return n;
      },
      { replace: true },
    );
  }
  const { data: presets = [] } = useModelPresetsQuery();
  const [toolCatalog, setToolCatalog] = useState<Record<string, unknown>[]>([]);
  const [currentPreset, setCurrentPreset] = useState<ModelPresetResponse | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetLoadError, setPresetLoadError] = useState<string | null>(null);

  const { section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = parseSettingsSection(section);

  async function load() {
    setLoadingSettings(true);
    try {
      const data = (await getLlmProviderSettings()) as LlmSettings;
      setSettings(data);
      return true;
    } finally {
      setLoadingSettings(false);
    }
  }

  async function save() {
    if (!settings) return false;
    await updateLlmProviderSettings(settings as unknown as LlmProviderSettingsDocument);
    // Push the just-persisted providers straight into the global store so
    // model selectors elsewhere (e.g. the prepare-step editor) update without
    // a reload — no server round-trip, we already hold the saved data.
    setGlobalProviders(settings.providers ?? []);
    return true;
  }

  async function testConnection(provider: LlmSettings["providers"][number]) {
    const res = await testLlmProviderConnection({
      provider_id: String(provider.id || ""),
      settings: provider.settings || {},
    });
    if (!res?.ok) throw new Error(res?.detail || "Connection test failed");
    const fetchedModels = Array.isArray(res?.models) ? res.models : [];
    setSettings((prev) => {
      if (!prev?.providers) return prev;
      const next = structuredClone(prev);
      const idx = next.providers.findIndex((x) => x?.id === provider?.id);
      if (idx >= 0) {
        const p = next.providers[idx] as Record<string, unknown>;
        p.models = fetchedModels;
        p.models_verified = true;
      }
      return next;
    });
    return true;
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadAgent(aid: string) {
    setAgentLoading(true);
    setAgentLoadError(null);
    setCurrentAgent(null);
    try {
      const ag = await getAgentById(aid);
      setCurrentAgent(ag);
    } catch (e) {
      setAgentLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentLoading(false);
    }
  }

  async function saveAgent() {
    if (!currentAgent) throw new Error("No agent loaded");
    const saved = await updateAgentById(currentAgent.id, {
      name: currentAgent.name,
      system_prompt: currentAgent.system_prompt,
      default_llm_configuration: currentAgent.default_llm_configuration,
      default_model_preset_id: currentAgent.default_model_preset_id,
      icon: currentAgent.icon,
      color: currentAgent.color,
    });
    setCurrentAgent(saved);
    await refreshAgents();
    return true;
  }

  async function saveAgentAndOpenChat(targetId?: string) {
    if (!currentAgent) throw new Error("No agent loaded");
    await saveAgent();
    const id = targetId || currentAgent.id;
    navigate(`/chat/new?agent=${encodeURIComponent(id)}`);
    return true;
  }

  async function createAgent() {
    const created = await createAgentApi();
    await refreshAgents();
    setAgentEditId(created.id);
    await loadAgent(created.id);
    notifyToast({ message: "Agent created", type: "success", durationMs: 4000 });
  }

  async function setLoadedAgentAsDefault() {
    if (!currentAgent) return;
    const updated = await setDefaultAgent(currentAgent.id);
    setCurrentAgent(updated);
    await refreshAgents();
  }

  async function deleteLoadedAgent() {
    if (!currentAgent) return;
    await deleteAgentById(currentAgent.id);
    const remaining = await refreshAgents();
    if (remaining.length > 0) {
      setAgentEditId(remaining[0].id);
      await loadAgent(remaining[0].id);
    } else {
      setAgentEditId("");
      setCurrentAgent(null);
    }
    notifyToast({ message: "Agent deleted", type: "success", durationMs: 4000 });
  }

  async function loadToolCatalog(): Promise<Record<string, unknown>[]> {
    try {
      const rows = await getToolsApi();
      const out = Array.isArray(rows)
        ? ((rows as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<
            string,
            unknown
          >[])
        : [];
      setToolCatalog(out);
      return out;
    } catch {
      setToolCatalog([]);
      return [];
    }
  }

  async function loadPreset(id: number) {
    setPresetLoading(true);
    setPresetLoadError(null);
    setCurrentPreset(null);
    try {
      const row = await getModelPresetById(id);
      setCurrentPreset(row);
    } catch (e) {
      setPresetLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(false);
    }
  }

  async function savePreset() {
    if (!currentPreset) throw new Error("No preset loaded");
    const saved = await updateModelPresetById(currentPreset.id, {
      name: currentPreset.name,
      parameters: currentPreset.parameters,
    });
    setCurrentPreset(saved);
    await refreshModelPresets();
    return true;
  }

  async function createPreset() {
    const created = await createModelPreset({});
    await refreshModelPresets();
    setPresetEditId(created.id);
    await loadPreset(created.id);
    notifyToast({ message: "Model preset created", type: "success", durationMs: 4000 });
  }

  async function deleteLoadedPreset() {
    if (!currentPreset) return;
    await deleteModelPresetById(currentPreset.id);
    const remaining = await refreshModelPresets();
    if (remaining.length > 0) {
      setPresetEditId(remaining[0].id);
      await loadPreset(remaining[0].id);
    } else {
      setPresetEditId(null);
      setCurrentPreset(null);
    }
    notifyToast({ message: "Model preset deleted", type: "success", durationMs: 4000 });
  }

  useEffect(() => {
    if (activeSection !== "agents") return;
    void loadToolCatalog().then(() => {
      if (agents.length === 0) return;
      if (agentEditId && agents.some((a) => a.id === agentEditId)) return;
      setAgentEditId(agents[0].id);
    });
  }, [activeSection, agents, agentEditId]);

  useEffect(() => {
    if (activeSection === "agents" && agentEditId) {
      void loadAgent(agentEditId);
    }
  }, [activeSection, agentEditId]);

  useEffect(() => {
    if (activeSection !== "model-presets") return;
    if (presets.length === 0) return;
    if (presetEditId != null && presets.some((p) => p.id === presetEditId)) return;
    setPresetEditId(presets[0].id);
  }, [activeSection, presets, presetEditId]);

  useEffect(() => {
    if (activeSection === "model-presets" && presetEditId != null) {
      void loadPreset(presetEditId);
    }
  }, [activeSection, presetEditId]);

  const modelGroups = useMemo(
    () => (settings ? buildModelGroups(settings.providers) : []),
    [settings],
  );
  const providerCards = useMemo(
    () => filterProviders(settings?.providers, search),
    [settings, search],
  );

  if (loadingSettings) {
    return (
      <section className="flex flex-col gap-3 p-4">
        <div className="inline-flex items-center gap-2 text-muted-foreground">
          <Spinner size={16} />
          <span>Loading settings...</span>
        </div>
      </section>
    );
  }

  if (!settings) {
    return <section className="p-4">Failed to load settings.</section>;
  }

  return (
    <section className="min-h-0 w-full flex-1 overflow-auto">
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <SettingsSidebar activeSection={activeSection} navigate={navigate} settingsSearch={location.search} />

        <main className="flex min-w-0 flex-col gap-3.5">
          {activeSection === "model-providers" ||
          activeSection === "model-presets" ||
          activeSection === "model-pricing" ||
          activeSection === "agents" ? null : (
            <SettingsHeader activeSection={activeSection} search={search} setSearch={setSearch} />
          )}

          {activeSection === "model-providers" ? (
            <div className="flex flex-col gap-3">
              <GlobalModelSettingsCard settings={settings} setSettings={setSettings} modelGroups={modelGroups} />
              {providerCards.map((p) => (
                <ProviderCard
                  key={String(p.id)}
                  provider={p}
                  settings={settings}
                  setSettings={setSettings}
                  testConnection={testConnection}
                  modelFilters={modelFilters}
                  setModelFilters={setModelFilters}
                  collapsedModels={collapsedModels}
                  setCollapsedModels={setCollapsedModels}
                />
              ))}
            </div>
          ) : activeSection === "model-presets" ? (
            <ModelPresetsEditor
              presets={presets}
              presetEditId={presetEditId}
              setPresetEditId={(id) => setPresetEditId(id)}
              currentPreset={currentPreset}
              setCurrentPreset={setCurrentPreset}
              loading={presetLoading}
              loadError={presetLoadError}
              createPreset={createPreset}
              savePreset={savePreset}
              deletePreset={deleteLoadedPreset}
            />
          ) : activeSection === "agents" ? (
            <AgentsEditor
              agents={agents}
              presets={presets}
              toolCatalog={toolCatalog}
              agentEditId={agentEditId}
              setAgentEditId={setAgentEditId}
              currentAgent={currentAgent}
              setCurrentAgent={setCurrentAgent}
              saveAgent={saveAgent}
              saveAgentAndOpenChat={saveAgentAndOpenChat}
              createAgent={createAgent}
              deleteLoadedAgent={deleteLoadedAgent}
              setLoadedAgentAsDefault={setLoadedAgentAsDefault}
              agentLoadError={agentLoadError}
              agentLoading={agentLoading}
              modelGroups={modelGroups}
            />
          ) : activeSection === "model-pricing" ? (
            <ModelPricingEditor />
          ) : activeSection === "tools" ? (
            <ToolsSettingsPlaceholder />
          ) : (
            <div className={settingsPlaceholderBox}>Skills UI placeholder.</div>
          )}

          {activeSection === "model-providers" ? (
            <div className="flex items-center gap-2.5">
              <AsyncButton onClickAsync={save} className={cn(ghostBtn, "border-slate-300")}>
                Save
              </AsyncButton>
            </div>
          ) : null}
        </main>
      </div>
    </section>
  );
}
