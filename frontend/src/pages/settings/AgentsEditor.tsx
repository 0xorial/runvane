import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { dezerialize } from "zodex";
import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { CodeEditor } from "../../components/ui/CodeEditor";
import { ZodJsonEditor } from "../../components/ui/ZodJsonEditor";
import { notifyError } from "../../utils/toast";
import { AgentLlmSettings } from "./AgentLlmSettings";
import { AgentGuardrailSettings, readGuardrailConfig } from "./AgentGuardrailSettings";
import { DEFAULT_GUARDRAIL_PROMPT } from "../../../../backend/src/contracts/guardrail";
import type { GuardrailConfig } from "./AgentGuardrailSettings";
import { sortAgents } from "./helpers";
import type { ModelGroup } from "./helpers";
import { AgentIconPicker } from "./AgentIconPicker";
import { AgentColorPicker } from "./AgentColorPicker";
import { cn } from "@/lib/utils";
import {
  chipActive,
  chipBase,
  chipText,
  ghostBtn,
  ghostDanger,
  loadError,
  loadHint,
  settingsPlaceholderBox,
} from "./settingsClasses";

type AgentsEditorProps = {
  agents: AgentListItemResponse[];
  presets: ModelPresetResponse[];
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
  toolCatalog: Record<string, unknown>[];
};

const nameInput =
  "ml-1.5 min-w-[140px] max-w-[420px] flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px]";

const systemPromptInput =
  "min-h-[110px] w-full resize-y rounded-[10px] border border-input bg-background px-2.5 py-2 text-[13px] leading-snug";

const toolsTableClass =
  "w-full border-collapse overflow-hidden rounded-[10px] border border-border text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-muted-foreground";

const toolsAgentsTableClass =
  "w-full border-collapse border border-border text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-background [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-muted-foreground";

const toolsConfigInput =
  "min-h-[120px] w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs leading-snug";

export function AgentsEditor({
  agents,
  presets,
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
  toolCatalog,
}: AgentsEditorProps) {
  const canEdit = !agentLoading && !agentLoadError && currentAgent != null;
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [toolConfigDrafts, setToolConfigDrafts] = useState<Record<string, string>>({});
  const [toolConfigErrors, setToolConfigErrors] = useState<Record<string, string>>({});

  // Each tool ships its rules Zod schema `zerialize`d in the catalog —
  // `dezerialize` reconstructs the real schema for the config editor.
  const toolRulesZodSchemas = useMemo(() => {
    const map = new Map<string, z.ZodType>();
    for (const raw of toolCatalog) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const name = String(rec.name ?? "").trim();
      if (!name || rec.rules_schema == null) continue;
      try {
        map.set(name, dezerialize(rec.rules_schema as never) as z.ZodType);
      } catch {
        // schema couldn't be reconstructed — editor falls back to plain JSON
      }
    }
    return map;
  }, [toolCatalog]);

  async function handleAddAgent() {
    try {
      await createAgent();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to create agent");
    }
  }

  async function handleDeleteAgent() {
    if (!currentAgent) return;
    if (!window.confirm(`Delete "${currentAgent.name}"?`)) return;
    try {
      await deleteLoadedAgent();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to delete agent");
    }
  }

  function getToolConfigFromAgent(
    agent: AgentListItemResponse | null | undefined,
    toolName: string,
  ): {
    enabled: boolean;
    guardrail: boolean;
    guardrail_system_prompt: string;
    config: Record<string, unknown>;
  } {
    const cfg =
      agent?.default_llm_configuration &&
      typeof agent.default_llm_configuration === "object" &&
      !Array.isArray(agent.default_llm_configuration)
        ? (agent.default_llm_configuration as Record<string, unknown>)
        : {};
    const tools =
      cfg.tools && typeof cfg.tools === "object" && !Array.isArray(cfg.tools)
        ? (cfg.tools as Record<string, unknown>)
        : {};
    const raw = tools[toolName];
    const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const config =
      rec.rules && typeof rec.rules === "object" && !Array.isArray(rec.rules)
        ? (rec.rules as Record<string, unknown>)
        : {};
    return {
      enabled: rec.enabled === true,
      guardrail: rec.guardrail === true,
      guardrail_system_prompt: typeof rec.guardrail_system_prompt === "string" ? rec.guardrail_system_prompt : "",
      config,
    };
  }

  function getToolConfig(toolName: string): {
    enabled: boolean;
    guardrail: boolean;
    guardrail_system_prompt: string;
    config: Record<string, unknown>;
  } {
    return getToolConfigFromAgent(currentAgent, toolName);
  }

  function patchToolConfig(
    toolName: string,
    patch: {
      enabled?: boolean;
      guardrail?: boolean;
      guardrail_system_prompt?: string;
      config?: Record<string, unknown>;
    },
  ) {
    if (!currentAgent || !canEdit) return;
    const currentCfg =
      currentAgent.default_llm_configuration &&
      typeof currentAgent.default_llm_configuration === "object" &&
      !Array.isArray(currentAgent.default_llm_configuration)
        ? (currentAgent.default_llm_configuration as Record<string, unknown>)
        : {};
    const nextCfg: Record<string, unknown> = { ...currentCfg };
    const tools =
      nextCfg.tools && typeof nextCfg.tools === "object" && !Array.isArray(nextCfg.tools)
        ? { ...(nextCfg.tools as Record<string, unknown>) }
        : {};
    const currentTool = tools[toolName];
    const toolRec =
      currentTool && typeof currentTool === "object" && !Array.isArray(currentTool)
        ? { ...(currentTool as Record<string, unknown>) }
        : {};
    if (patch.enabled !== undefined) toolRec.enabled = patch.enabled;
    if (patch.guardrail !== undefined) toolRec.guardrail = patch.guardrail;
    if (patch.guardrail_system_prompt !== undefined) {
      if (patch.guardrail_system_prompt === "") {
        delete toolRec.guardrail_system_prompt;
      } else {
        toolRec.guardrail_system_prompt = patch.guardrail_system_prompt;
      }
    }
    if (patch.config !== undefined) toolRec.rules = patch.config;
    tools[toolName] = toolRec;
    nextCfg.tools = tools;
    setCurrentAgent({
      ...currentAgent,
      default_llm_configuration: nextCfg,
    });
  }

  function patchGuardrailConfig(patch: Partial<GuardrailConfig>) {
    if (!currentAgent || !canEdit) return;
    const currentCfg = (currentAgent.default_llm_configuration ?? {}) as Record<string, unknown>;
    const currentGuardrail = readGuardrailConfig(currentCfg);
    setCurrentAgent({
      ...currentAgent,
      default_llm_configuration: {
        ...currentCfg,
        guardrail: { ...currentGuardrail, ...patch },
      },
    });
  }

  function toggleToolExpanded(toolName: string, next?: boolean) {
    setExpandedTools((prev) => ({
      ...prev,
      [toolName]: next ?? !prev[toolName],
    }));
  }

  function getToolDefaultConfig(toolName: string): Record<string, unknown> {
    const tool = toolCatalog.find((raw) => String((raw as Record<string, unknown>).name ?? "") === toolName);
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return {};
    const rec = tool as Record<string, unknown>;
    const defaultRulesRaw = rec.default_rules;
    if (defaultRulesRaw && typeof defaultRulesRaw === "object" && !Array.isArray(defaultRulesRaw)) {
      return { ...(defaultRulesRaw as Record<string, unknown>) };
    }
    const rulesSchema =
      rec.rules_schema && typeof rec.rules_schema === "object" && !Array.isArray(rec.rules_schema)
        ? (rec.rules_schema as Record<string, unknown>)
        : {};
    const properties =
      rulesSchema.properties && typeof rulesSchema.properties === "object" && !Array.isArray(rulesSchema.properties)
        ? (rulesSchema.properties as Record<string, unknown>)
        : {};
    const defaults: Record<string, unknown> = {};
    for (const [key, rawProp] of Object.entries(properties)) {
      if (!rawProp || typeof rawProp !== "object" || Array.isArray(rawProp)) continue;
      const prop = rawProp as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(prop, "default")) {
        defaults[key] = prop.default;
        continue;
      }
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        defaults[key] = prop.enum[0];
        continue;
      }
      const type = typeof prop.type === "string" ? prop.type : "";
      if (type === "boolean") defaults[key] = false;
      else if (type === "number" || type === "integer") defaults[key] = 0;
      else if (type === "string") defaults[key] = "";
      else if (type === "array") defaults[key] = [];
      else if (type === "object") defaults[key] = {};
    }
    return defaults;
  }

  function getToolConfigDraft(toolName: string): string {
    const existing = toolConfigDrafts[toolName];
    if (existing != null) return existing;
    const current = getToolConfig(toolName).config;
    const base = Object.keys(current).length > 0 ? current : getToolDefaultConfig(toolName);
    return JSON.stringify(base, null, 2);
  }

  function onToolConfigDraftChange(toolName: string, raw: string) {
    setToolConfigDrafts((prev) => ({
      ...prev,
      [toolName]: raw,
    }));
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setToolConfigErrors((prev) => ({
          ...prev,
          [toolName]: "Config must be a JSON object.",
        }));
        return;
      }
      patchToolConfig(toolName, { config: parsed as Record<string, unknown> });
      setToolConfigErrors((prev) => {
        const next = { ...prev };
        delete next[toolName];
        return next;
      });
    } catch {
      setToolConfigErrors((prev) => ({
        ...prev,
        [toolName]: "Invalid JSON.",
      }));
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2.5">
        <button type="button" className={ghostBtn} onClick={() => void handleAddAgent()}>
          Add agent
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="list" aria-label="Agents">
          {sortAgents(agents).map((a) => (
            <button
              key={a.id}
              type="button"
              role="listitem"
              className={cn(chipBase, a.id === agentEditId && chipActive)}
              title={a.name}
              onClick={() => setAgentEditId(a.id)}
            >
              <span className={chipText}>{a.name || "Unnamed"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={cn(settingsPlaceholderBox, "border-solid")}>
        {agentLoading ? (
          <div className={loadHint}>Loading agent…</div>
        ) : (
          <>
            {agentLoadError && (
              <div className={loadError} role="alert">
                Failed to load agent: {agentLoadError}
              </div>
            )}
            {currentAgent && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2.5">
                  <AgentIconPicker
                    value={currentAgent.icon}
                    colorId={currentAgent.color}
                    onChange={(iconId) => setCurrentAgent({ ...currentAgent, icon: iconId })}
                    disabled={!canEdit}
                  />
                  <AgentColorPicker
                    value={currentAgent.color}
                    onChange={(colorId) => setCurrentAgent({ ...currentAgent, color: colorId })}
                    disabled={!canEdit}
                  />
                  <label className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
                    Name
                    <input
                      type="text"
                      className={nameInput}
                      value={currentAgent.name}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setCurrentAgent({
                          ...currentAgent,
                          name: e.target.value,
                        })
                      }
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="Display name"
                    />
                  </label>
                  <div className="ml-auto inline-flex flex-wrap items-center gap-2.5">
                    {currentAgent.is_default ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        default
                      </span>
                    ) : (
                      <AsyncButton
                        className={ghostBtn}
                        disabled={!canEdit}
                        onClickAsync={async () => {
                          await setLoadedAgentAsDefault();
                          return true;
                        }}
                      >
                        Set as default
                      </AsyncButton>
                    )}
                    <button
                      type="button"
                      className={cn(ghostBtn, ghostDanger)}
                      onClick={() => void handleDeleteAgent()}
                    >
                      Delete
                    </button>
                    <AsyncButton className={ghostBtn} disabled={!canEdit} onClickAsync={saveAgent}>
                      Save
                    </AsyncButton>
                    <AsyncButton
                      className={ghostBtn}
                      disabled={!canEdit}
                      onClickAsync={() => saveAgentAndOpenChat(agentEditId)}
                    >
                      Save &amp; chat
                    </AsyncButton>
                  </div>
                </div>
                <AgentLlmSettings
                  agent={currentAgent}
                  onChange={setCurrentAgent}
                  canEdit={canEdit}
                  modelGroups={modelGroups}
                  presets={presets}
                />
                <label className="mb-3 mt-3 flex flex-col gap-2 text-[13px] text-muted-foreground">
                  System prompt
                  <textarea
                    className={systemPromptInput}
                    value={currentAgent.system_prompt}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setCurrentAgent({
                        ...currentAgent,
                        system_prompt: e.target.value,
                      })
                    }
                    spellCheck={false}
                    rows={5}
                  />
                </label>
                <AgentGuardrailSettings
                  config={readGuardrailConfig(
                    (currentAgent.default_llm_configuration ?? {}) as Record<string, unknown>,
                  )}
                  onChange={patchGuardrailConfig}
                  canEdit={canEdit}
                  modelGroups={modelGroups}
                />
                <div className="mt-3.5">
                  <div className="mb-2 text-[13px] font-bold text-foreground">Tools</div>
                  <table className={toolsTableClass}>
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Description</th>
                        <th>Enabled</th>
                        <th title="Requires Guardrail LLM to be configured above">Guardrail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolCatalog.map((raw) => {
                        const row = raw as Record<string, unknown>;
                        const name = String(row.name ?? "").trim();
                        if (!name) return null;
                        const cfg = getToolConfig(name);
                        const expanded = !!expandedTools[name] && cfg.enabled;
                        const guardrailLlm = readGuardrailConfig(
                          (currentAgent.default_llm_configuration ?? {}) as Record<string, unknown>,
                        );
                        const guardrailLlmConfigured =
                          guardrailLlm.provider_id.length > 0 && guardrailLlm.model_name.length > 0;
                        return [
                          <tr key={`${name}-row`}>
                            <td>
                              {cfg.enabled ? (
                                <button
                                  type="button"
                                  className="-mx-1 -my-0.5 inline-flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                                  disabled={!canEdit}
                                  onClick={() => toggleToolExpanded(name)}
                                  aria-expanded={expanded}
                                  aria-label={expanded ? "Hide config" : "Show config"}
                                  title={expanded ? "Hide config" : "Show config"}
                                >
                                  {expanded ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  )}
                                  <code>{name}</code>
                                </button>
                              ) : (
                                <div className="inline-flex items-center gap-2">
                                  <span className="inline-flex h-4 w-4 shrink-0" aria-hidden="true" />
                                  <code className="text-muted-foreground">{name}</code>
                                </div>
                              )}
                            </td>
                            <td className="max-w-[360px] text-muted-foreground">
                              {row.description != null ? String(row.description) : "—"}
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={cfg.enabled}
                                disabled={!canEdit}
                                onChange={(e) => {
                                  const nextEnabled = e.target.checked;
                                  patchToolConfig(name, { enabled: nextEnabled });
                                  if (nextEnabled) {
                                    if (Object.keys(cfg.config).length === 0) {
                                      const defaults = getToolDefaultConfig(name);
                                      if (Object.keys(defaults).length > 0) {
                                        patchToolConfig(name, { config: defaults });
                                      }
                                    }
                                    toggleToolExpanded(name, true);
                                  }
                                  if (!nextEnabled) toggleToolExpanded(name, false);
                                }}
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={cfg.guardrail}
                                disabled={!canEdit || !cfg.enabled || !guardrailLlmConfigured}
                                title={
                                  !guardrailLlmConfigured
                                    ? "Configure the Guardrail LLM above first"
                                    : !cfg.enabled
                                      ? "Enable the tool first"
                                      : undefined
                                }
                                onChange={(e) =>
                                  patchToolConfig(name, { guardrail: e.target.checked })
                                }
                              />
                            </td>
                          </tr>,
                          expanded ? (
                            <tr key={`${name}-config`}>
                              <td colSpan={4} className="bg-muted/50">
                                <div className="p-2">
                                  <div className="mb-2 text-xs font-semibold text-foreground">
                                    <code>{name}</code> config (JSON)
                                  </div>
                                  {toolRulesZodSchemas.get(name) ? (
                                    <ZodJsonEditor
                                      schema={toolRulesZodSchemas.get(name)!}
                                      value={getToolConfigDraft(name)}
                                      onChange={(v) => onToolConfigDraftChange(name, v)}
                                      height={200}
                                      readOnly={!canEdit}
                                    />
                                  ) : (
                                    <>
                                      <CodeEditor
                                        value={getToolConfigDraft(name)}
                                        onChange={(v) => onToolConfigDraftChange(name, v)}
                                        language="json"
                                        height={200}
                                        readOnly={!canEdit}
                                      />
                                      {toolConfigErrors[name] ? (
                                        <div className="mt-2 text-xs text-destructive" role="alert">
                                          {toolConfigErrors[name]}
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                  {cfg.guardrail && guardrailLlmConfigured && (
                                    <div className="mt-3">
                                      <label className="flex flex-col gap-1 text-xs">
                                        <span className="font-semibold text-foreground">
                                          Guardrail prompt override{" "}
                                          <span className="font-normal text-muted-foreground">(leave blank to use global prompt)</span>
                                        </span>
                                        <textarea
                                          className={toolsConfigInput}
                                          style={{ minHeight: 72 }}
                                          value={cfg.guardrail_system_prompt}
                                          disabled={!canEdit}
                                          onChange={(e) =>
                                            patchToolConfig(name, { guardrail_system_prompt: e.target.value })
                                          }
                                          placeholder={readGuardrailConfig(
                                            (currentAgent.default_llm_configuration ?? {}) as Record<string, unknown>,
                                          ).system_prompt || DEFAULT_GUARDRAIL_PROMPT}
                                          rows={3}
                                          spellCheck={false}
                                        />
                                      </label>
                                    </div>
                                  )}
                                  <div className="mt-2.5">
                                    <div className="mb-1.5 text-xs font-semibold text-foreground">
                                      Agent permissions
                                    </div>
                                    <table className={toolsAgentsTableClass}>
                                      <thead>
                                        <tr>
                                          <th>Agent ID</th>
                                          <th>Agent name</th>
                                          <th>Enabled</th>
                                          <th>Guardrail</th>
                                          <th>Permissions config</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sortAgents(agents).map((agentRow) => {
                                          const agentCfg = getToolConfigFromAgent(agentRow, name);
                                          return (
                                            <tr key={`${name}-${agentRow.id}`}>
                                              <td>
                                                <code>{agentRow.id}</code>
                                              </td>
                                              <td>{agentRow.name || "Unnamed"}</td>
                                              <td>{agentCfg.enabled ? "true" : "false"}</td>
                                              <td>{agentCfg.guardrail ? "true" : "false"}</td>
                                              <td>
                                                <code>{JSON.stringify(agentCfg.config)}</code>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
