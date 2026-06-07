<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import { DEFAULT_GUARDRAIL_PROMPT } from "../../../../backend/src/contracts/guardrail";
  import { readGuardrailConfig } from "./agentGuardrail";
  import {
    getToolConfigFromAgent,
    getToolDefaultConfig,
    patchToolConfigOnAgent,
    type ToolConfig,
  } from "./agentTools";
  import { sortAgents } from "./helpers";

  let {
    currentAgent,
    agents,
    toolCatalog,
    canEdit,
    onAgentChange,
  }: {
    currentAgent: AgentListItemResponse;
    agents: AgentListItemResponse[];
    toolCatalog: Record<string, unknown>[];
    canEdit: boolean;
    onAgentChange: (agent: AgentListItemResponse) => void;
  } = $props();

  let expandedTools = $state<Record<string, boolean>>({});
  let toolConfigDrafts = $state<Record<string, string>>({});
  let toolConfigErrors = $state<Record<string, string>>({});

  const guardrailLlm = $derived(readGuardrailConfig(currentAgent.default_llm_configuration as Record<string, unknown>));
  const guardrailLlmConfigured = $derived(
    guardrailLlm.provider_id.length > 0 && guardrailLlm.model_name.length > 0,
  );

  function getToolConfig(toolName: string): ToolConfig {
    return getToolConfigFromAgent(currentAgent, toolName);
  }

  function patchTool(toolName: string, patch: Parameters<typeof patchToolConfigOnAgent>[2]): void {
    if (!canEdit) return;
    onAgentChange(patchToolConfigOnAgent(currentAgent, toolName, patch));
  }

  function toggleExpanded(toolName: string, next?: boolean): void {
    expandedTools = { ...expandedTools, [toolName]: next ?? !expandedTools[toolName] };
  }

  function getToolConfigDraft(toolName: string): string {
    const existing = toolConfigDrafts[toolName];
    if (existing != null) return existing;
    const current = getToolConfig(toolName).config;
    const base = Object.keys(current).length > 0 ? current : getToolDefaultConfig(toolCatalog, toolName);
    return JSON.stringify(base, null, 2);
  }

  function onToolConfigDraftChange(toolName: string, raw: string): void {
    toolConfigDrafts = { ...toolConfigDrafts, [toolName]: raw };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        toolConfigErrors = { ...toolConfigErrors, [toolName]: "Config must be a JSON object." };
        return;
      }
      patchTool(toolName, { config: parsed as Record<string, unknown> });
      const nextErrors = { ...toolConfigErrors };
      delete nextErrors[toolName];
      toolConfigErrors = nextErrors;
    } catch {
      toolConfigErrors = { ...toolConfigErrors, [toolName]: "Invalid JSON." };
    }
  }
</script>

<div class="mt-3.5">
  <div class="mb-2 text-[13px] font-bold text-foreground">Tools</div>
  <table
    class="w-full border-collapse overflow-hidden rounded-[10px] border border-border text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-muted-foreground"
  >
    <thead>
      <tr>
        <th>Tool</th>
        <th>Description</th>
        <th>Enabled</th>
        <th title="Requires Guardrail LLM to be configured above">Guardrail</th>
      </tr>
    </thead>
    <tbody>
      {#each toolCatalog as raw (String(raw.name ?? ""))}
        {@const row = raw as Record<string, unknown>}
        {@const name = String(row.name ?? "").trim()}
        {#if name}
          {@const cfg = getToolConfig(name)}
          {@const expanded = !!expandedTools[name] && cfg.enabled}
          <tr>
            <td>
              {#if cfg.enabled}
                <button
                  type="button"
                  class="-mx-1 inline-flex items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left hover:bg-muted disabled:cursor-default"
                  disabled={!canEdit}
                  onclick={() => toggleExpanded(name)}
                  aria-expanded={expanded}
                >
                  <span class="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
                  <code>{name}</code>
                </button>
              {:else}
                <div class="inline-flex items-center gap-2 pl-5">
                  <code class="text-muted-foreground">{name}</code>
                </div>
              {/if}
            </td>
            <td class="max-w-[360px] text-muted-foreground">
              {row.description != null ? String(row.description) : "—"}
            </td>
            <td>
              <input
                type="checkbox"
                checked={cfg.enabled}
                disabled={!canEdit}
                onchange={(e) => {
                  const nextEnabled = e.currentTarget.checked;
                  patchTool(name, { enabled: nextEnabled });
                  if (nextEnabled) {
                    if (Object.keys(cfg.config).length === 0) {
                      const defaults = getToolDefaultConfig(toolCatalog, name);
                      if (Object.keys(defaults).length > 0) patchTool(name, { config: defaults });
                    }
                    toggleExpanded(name, true);
                  } else {
                    toggleExpanded(name, false);
                  }
                }}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={cfg.guardrail}
                disabled={!canEdit || !cfg.enabled || !guardrailLlmConfigured}
                title={!guardrailLlmConfigured
                  ? "Configure the Guardrail LLM above first"
                  : !cfg.enabled
                    ? "Enable the tool first"
                    : undefined}
                onchange={(e) => patchTool(name, { guardrail: e.currentTarget.checked })}
              />
            </td>
          </tr>
          {#if expanded}
            <tr>
              <td colspan="4" class="bg-muted/50">
                <div class="p-2">
                  <div class="mb-2 text-xs font-semibold text-foreground">
                    <code>{name}</code> config (JSON)
                  </div>
                  <textarea
                    class="min-h-[120px] w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs leading-snug"
                    value={getToolConfigDraft(name)}
                    readonly={!canEdit}
                    oninput={(e) => onToolConfigDraftChange(name, e.currentTarget.value)}
                  ></textarea>
                  {#if toolConfigErrors[name]}
                    <div class="mt-2 text-xs text-destructive" role="alert">{toolConfigErrors[name]}</div>
                  {/if}
                  {#if cfg.guardrail && guardrailLlmConfigured}
                    <div class="mt-3">
                      <label class="flex flex-col gap-1 text-xs">
                        <span class="font-semibold text-foreground">
                          Guardrail prompt override
                          <span class="font-normal text-muted-foreground">(leave blank to use global prompt)</span>
                        </span>
                        <textarea
                          class="min-h-[72px] w-full resize-y rounded-lg border border-input bg-background p-2 text-xs"
                          value={cfg.guardrail_system_prompt}
                          disabled={!canEdit}
                          oninput={(e) => patchTool(name, { guardrail_system_prompt: e.currentTarget.value })}
                          placeholder={guardrailLlm.system_prompt || DEFAULT_GUARDRAIL_PROMPT}
                          rows={3}
                          spellcheck={false}
                        ></textarea>
                      </label>
                    </div>
                  {/if}
                  <div class="mt-2.5">
                    <div class="mb-1.5 text-xs font-semibold text-foreground">Agent permissions</div>
                    <table
                      class="w-full border-collapse border border-border text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-border [&_th]:bg-background [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-bold"
                    >
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
                        {#each sortAgents(agents) as agentRow (agentRow.id)}
                          {@const agentCfg = getToolConfigFromAgent(agentRow, name)}
                          <tr>
                            <td><code>{agentRow.id}</code></td>
                            <td>{agentRow.name || "Unnamed"}</td>
                            <td>{agentCfg.enabled ? "true" : "false"}</td>
                            <td>{agentCfg.guardrail ? "true" : "false"}</td>
                            <td><code>{JSON.stringify(agentCfg.config)}</code></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
          {/if}
        {/if}
      {/each}
    </tbody>
  </table>
</div>
