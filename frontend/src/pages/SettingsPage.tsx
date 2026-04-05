import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AgentListItemResponse } from "../../../backend/src/routes/agents.types";
import type { LlmProviderSettingsDocument } from "../../../backend/src/routes/settings.types";
import type { ModelPresetResponse } from "../../../backend/src/routes/modelPresets.types";
import {
  createAgent as createAgentApi,
  createModelPreset,
  deleteAgentById,
  deleteModelPresetById,
  getAgentById,
  getAgents as getAgentsApi,
  getLlmProviderSettings,
  getTools as getToolsApi,
  getModelPresetById,
  getModelPresets,
  testLlmProviderConnection,
  updateAgentById,
  updateModelPresetById,
  updateLlmProviderSettings,
} from "../api/client";
import { AsyncButton } from "../components/ui/AsyncButton";
import { Spinner } from "../components/ui/Spinner";
import { AgentsEditor } from "./settings/AgentsEditor";
import { GlobalModelSettingsCard } from "./settings/GlobalModelSettingsCard";
import { ModelPresetsEditor } from "./settings/ModelPresetsEditor";
import {
  filterProviders,
  normalizeSection,
  buildModelGroups,
} from "./settings/helpers";
import type { LlmSettings } from "../types/llmSettings";
import { ProviderCard } from "./settings/ProviderCard";
import { SettingsHeader } from "./settings/SettingsHeader";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { notifyToast } from "../utils/toast";
import styles from "./SettingsPage.module.css";

function ToolsSettingsPlaceholder() {
  return (
    <div className={styles.settingsPlaceholder}>
      Per-agent tool enablement and approval policy: open{" "}
      <strong>Agents</strong> → pick an agent →{" "}
      <strong>Tools &amp; permissions</strong>.
    </div>
  );
}

export function SettingsPage() {
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

  const [agents, setAgents] = useState<AgentListItemResponse[]>([]);
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
  const [presets, setPresets] = useState<ModelPresetResponse[]>([]);
  const [toolCatalog, setToolCatalog] = useState<Record<string, unknown>[]>([]);
  const [currentPreset, setCurrentPreset] = useState<ModelPresetResponse | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetLoadError, setPresetLoadError] = useState<string | null>(null);

  const { section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = normalizeSection(section);

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

  async function loadAgents(): Promise<AgentListItemResponse[]> {
    try {
      const data = await getAgentsApi();
      setAgents(data);
      return data;
    } catch {
      setAgents([]);
      return [];
    }
  }

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
    });
    setCurrentAgent(saved);
    await loadAgents();
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
    await loadAgents();
    setAgentEditId(created.id);
    await loadAgent(created.id);
    notifyToast({ message: "Agent created", type: "success", durationMs: 4000 });
  }

  async function deleteLoadedAgent() {
    if (!currentAgent) return;
    await deleteAgentById(currentAgent.id);
    const remaining = await loadAgents();
    if (remaining.length > 0) {
      setAgentEditId(remaining[0].id);
      await loadAgent(remaining[0].id);
    } else {
      setAgentEditId("");
      setCurrentAgent(null);
    }
    notifyToast({ message: "Agent deleted", type: "success", durationMs: 4000 });
  }

  async function loadPresets(): Promise<ModelPresetResponse[]> {
    try {
      const data = await getModelPresets();
      setPresets(data);
      return data;
    } catch {
      setPresets([]);
      return [];
    }
  }

  async function loadToolCatalog(): Promise<Record<string, unknown>[]> {
    try {
      const rows = await getToolsApi();
      const out = Array.isArray(rows)
        ? (rows as unknown[]).filter(
            (x) => x && typeof x === "object" && !Array.isArray(x),
          ) as Record<string, unknown>[]
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
    await loadPresets();
    return true;
  }

  async function createPreset() {
    const created = await createModelPreset({});
    await loadPresets();
    setPresetEditId(created.id);
    await loadPreset(created.id);
    notifyToast({ message: "Model preset created", type: "success", durationMs: 4000 });
  }

  async function deleteLoadedPreset() {
    if (!currentPreset) return;
    await deleteModelPresetById(currentPreset.id);
    const remaining = await loadPresets();
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
    void Promise.all([loadAgents(), loadPresets(), loadToolCatalog()]).then(([list]) => {
      if (list.length === 0) return;
      if (agentEditId && list.some((a) => a.id === agentEditId)) return;
      setAgentEditId(list[0].id);
    });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "agents" && agentEditId) {
      void loadAgent(agentEditId);
    }
  }, [activeSection, agentEditId]);

  useEffect(() => {
    if (activeSection !== "model_presets") return;
    void loadPresets().then((list) => {
      if (list.length === 0) return;
      if (presetEditId != null && list.some((p) => p.id === presetEditId)) return;
      setPresetEditId(list[0].id);
    });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "model_presets" && presetEditId != null) {
      void loadPreset(presetEditId);
    }
  }, [activeSection, presetEditId]);

  if (loadingSettings) {
    return (
      <section className={styles.loading}>
        <div className={styles.loadingRow}>
          <Spinner size={16} />
          <span>Loading settings...</span>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className={styles.loading}>Failed to load settings.</section>
    );
  }

  const providerCards = filterProviders(settings.providers || [], search);
  const modelGroups = buildModelGroups(settings.providers || []);

  return (
    <section className={styles.settingsPage}>
      <div className={styles.settingsPageLayout}>
        <SettingsSidebar
          activeSection={activeSection}
          navigate={navigate}
          settingsSearch={location.search}
        />

        <main className={styles.settingsContent}>
          {activeSection === "model_provider" ||
          activeSection === "model_presets" ||
          activeSection === "agents" ? null : (
            <SettingsHeader
              activeSection={activeSection}
              search={search}
              setSearch={setSearch}
            />
          )}

          {activeSection === "model_provider" ? (
            <div className={styles.settingsProviderGrid}>
              <GlobalModelSettingsCard
                settings={settings}
                setSettings={setSettings}
                modelGroups={modelGroups}
              />
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
          ) : activeSection === "model_presets" ? (
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
              agentLoadError={agentLoadError}
              agentLoading={agentLoading}
              modelGroups={modelGroups}
            />
          ) : activeSection === "tools" ? (
            <ToolsSettingsPlaceholder />
          ) : (
            <div className={styles.settingsPlaceholder}>
              Skills UI placeholder.
            </div>
          )}

          {activeSection === "model_provider" ? (
            <div className={styles.settingsFooterActions}>
              <AsyncButton
                onClickAsync={save}
                className={`btn ${styles.footerButton}`}
              >
                Save
              </AsyncButton>
            </div>
          ) : null}
        </main>
      </div>
    </section>
  );
}
