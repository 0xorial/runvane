import { useState } from "react";
import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { AsyncButton } from "../../components/ui/AsyncButton";
import { notifyError } from "../../utils/toast";
import { AgentLlmSettings } from "./AgentLlmSettings";
import { sortAgents } from "./helpers";
import type { ModelGroup } from "./helpers";
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
  agentLoadError,
  agentLoading,
  modelGroups,
  toolCatalog,
}: AgentsEditorProps) {
  const canEdit = !agentLoading && !agentLoadError && currentAgent != null;
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [toolConfigDrafts, setToolConfigDrafts] = useState<Record<string, string>>({});
  const [toolConfigErrors, setToolConfigErrors] = useState<Record<string, string>>({});

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
      enabled: rec.enabled !== false,
      config,
    };
  }

  function getToolConfig(toolName: string): {
    enabled: boolean;
    config: Record<string, unknown>;
  } {
    return getToolConfigFromAgent(currentAgent, toolName);
  }

  function patchToolConfig(
    toolName: string,
    patch: {
      enabled?: boolean;
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
    if (patch.config !== undefined) toolRec.rules = patch.config;
    tools[toolName] = toolRec;
    nextCfg.tools = tools;
    setCurrentAgent({
      ...currentAgent,
      default_llm_configuration: nextCfg,
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
                <label className="mb-3 flex flex-col gap-2 text-[13px] text-muted-foreground">
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
                    placeholder="Global instructions for this agent. Applied before every request."
                    rows={5}
                  />
                </label>
                <AgentLlmSettings
                  agent={currentAgent}
                  onChange={setCurrentAgent}
                  canEdit={canEdit}
                  modelGroups={modelGroups}
                  presets={presets}
                />
                <div className="mt-3.5">
                  <div className="mb-2 text-[13px] font-bold text-foreground">Tools</div>
                  <table className={toolsTableClass}>
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Description</th>
                        <th>Enabled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolCatalog.map((raw) => {
                        const row = raw as Record<string, unknown>;
                        const name = String(row.name ?? "").trim();
                        if (!name) return null;
                        const cfg = getToolConfig(name);
                        const expanded = !!expandedTools[name] && cfg.enabled;
                        return [
                          <tr key={`${name}-row`}>
                            <td>
                              <div className="inline-flex items-center gap-1.5">
                                {cfg.enabled ? (
                                  <button
                                    type="button"
                                    className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted-foreground hover:text-foreground"
                                    disabled={!canEdit}
                                    onClick={() => toggleToolExpanded(name)}
                                    aria-label={expanded ? "Hide config" : "Show config"}
                                    title={expanded ? "Hide config" : "Show config"}
                                  >
                                    {expanded ? "▾" : "▸"}
                                  </button>
                                ) : (
                                  <span
                                    className="inline-flex h-4 w-4 items-center justify-center text-[11px] text-transparent"
                                    aria-hidden="true"
                                  >
                                    ▸
                                  </span>
                                )}
                                <code>{name}</code>
                              </div>
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
                          </tr>,
                          expanded ? (
                            <tr key={`${name}-config`}>
                              <td colSpan={3} className="bg-muted/50">
                                <div className="p-2">
                                  <div className="mb-2 text-xs font-semibold text-foreground">
                                    <code>{name}</code> config (JSON)
                                  </div>
                                  <textarea
                                    className={toolsConfigInput}
                                    value={getToolConfigDraft(name)}
                                    disabled={!canEdit}
                                    onChange={(e) => onToolConfigDraftChange(name, e.target.value)}
                                    spellCheck={false}
                                    rows={8}
                                  />
                                  {toolConfigErrors[name] ? (
                                    <div className="mt-2 text-xs text-destructive" role="alert">
                                      {toolConfigErrors[name]}
                                    </div>
                                  ) : null}
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
