<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { AgentToolConfig } from "../../../../backend/src/agents/agent.entity";
  import { getTools } from "@/api/client";
  import ToolRulesEditor from "@/components/settings/ToolRulesEditor.svelte";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { agentIdFromSearch } from "@/lib/router";
  import {
    getSelectedToolForEdit,
    getToolDraftEntry,
    setSelectedToolForEdit,
    setToolDraftCustom,
  } from "@/lib/chatToolDraft.svelte";
  import { readGuardrailConfig } from "@/pages/settings/agentGuardrail";
  import {
    getToolConfigFromAgent,
    getToolDefaultConfig,
    patchToolConfigOnAgent,
    type ToolConfig,
  } from "@/pages/settings/agentTools";
  import { buildToolRulesZodSchemas } from "@/pages/settings/toolRulesSchemas";

  let { search }: { search: string } = $props();

  const agentsQuery = createAgentsQuery();
  const toolsQuery = createQuery(() => ({
    queryKey: queryKeys.tools,
    queryFn: getTools,
  }));

  const toolName = $derived(getSelectedToolForEdit());
  const agentId = $derived.by(() => {
    const fromUrl = agentIdFromSearch(search);
    if (fromUrl) return fromUrl;
    const agents = agentsQuery.data ?? [];
    return agents.find((a) => a.is_default)?.id ?? agents[0]?.id ?? "";
  });
  const agent = $derived((agentsQuery.data ?? []).find((row) => row.id === agentId) ?? null);
  const toolCatalog = $derived(toolsQuery.data ?? []);
  const rulesSchemas = $derived(buildToolRulesZodSchemas(toolCatalog));

  const workingConfig = $derived.by((): ToolConfig | null => {
    if (!toolName || !agent) return null;
    const entry = getToolDraftEntry(toolName);
    if (entry.mode === "custom" && entry.custom) {
      return {
        enabled: entry.custom.enabled !== false,
        guardrail: entry.custom.guardrail === true,
        guardrail_system_prompt: entry.custom.guardrail_system_prompt ?? "",
        config:
          entry.custom.rules && typeof entry.custom.rules === "object" && !Array.isArray(entry.custom.rules)
            ? (entry.custom.rules as Record<string, unknown>)
            : getToolDefaultConfig(toolCatalog, toolName),
      };
    }
    const fromAgent = getToolConfigFromAgent(agent, toolName);
    const rules =
      Object.keys(fromAgent.config).length > 0
        ? fromAgent.config
        : getToolDefaultConfig(toolCatalog, toolName);
    return { ...fromAgent, enabled: true, config: rules };
  });

  const guardrailLlm = $derived(
    agent ? readGuardrailConfig(agent.default_llm_configuration as Record<string, unknown>) : null,
  );

  function toAgentToolConfig(cfg: ToolConfig): AgentToolConfig {
    return {
      enabled: true,
      rules: cfg.config,
      guardrail: cfg.guardrail,
      ...(cfg.guardrail_system_prompt.trim() ? { guardrail_system_prompt: cfg.guardrail_system_prompt.trim() } : {}),
    };
  }

  function onPatch(patch: Parameters<typeof patchToolConfigOnAgent>[2]): void {
    if (!toolName || !agent || !workingConfig) return;
    const nextAgent = patchToolConfigOnAgent(agent, toolName, patch);
    const nextCfg = getToolConfigFromAgent(nextAgent, toolName);
    setToolDraftCustom(toolName, toAgentToolConfig({ ...nextCfg, enabled: true }));
  }
</script>

{#if toolName && workingConfig && guardrailLlm}
  <div class="flex h-full min-h-0 flex-col" data-testid="chat-tool-override-editor">
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        onclick={() => setSelectedToolForEdit(null)}
      >
        ← Branches
      </button>
      <span class="truncate text-xs font-semibold text-foreground">Custom: {toolName}</span>
    </div>
    <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
      <ToolRulesEditor
        toolName={toolName}
        config={workingConfig}
        rulesSchema={rulesSchemas.get(toolName)}
        guardrailLlmConfigured={guardrailLlm.provider_id.length > 0 && guardrailLlm.model_name.length > 0}
        globalGuardrailPrompt={guardrailLlm.system_prompt}
        onPatch={onPatch}
      />
    </div>
  </div>
{/if}
