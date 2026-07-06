<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import ToolRulesEditor from "@/components/settings/ToolRulesEditor.svelte";
  import { SEGMENT_ACTIVE_CLASS } from "@/lib/segmentColors";
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import { readGuardrailConfig } from "./agentGuardrail";
  import {
    getAgentSeparateParamsResolution,
    getToolConfigFromAgent,
    getToolDefaultConfig,
    patchAgentSeparateParamsResolution,
    patchToolConfigOnAgent,
    TOOL_POLICIES,
    type ToolConfig,
    type ToolPolicy,
  } from "./agentTools";
  import { buildToolRulesZodSchemas } from "./toolRulesSchemas";

  let {
    currentAgent,
    toolCatalog,
    canEdit,
    onAgentChange,
  }: {
    currentAgent: AgentListItemResponse;
    toolCatalog: Record<string, unknown>[];
    canEdit: boolean;
    onAgentChange: (agent: AgentListItemResponse) => void;
  } = $props();

  let expandedTools = $state<Record<string, boolean>>({});

  const guardrailLlm = $derived(readGuardrailConfig(currentAgent.default_llm_configuration as Record<string, unknown>));
  const guardrailLlmConfigured = $derived(
    guardrailLlm.provider_id.length > 0 && guardrailLlm.model_name.length > 0,
  );
  const toolRulesZodSchemas = $derived(buildToolRulesZodSchemas(toolCatalog));
  const agentSeparateParamsResolution = $derived(getAgentSeparateParamsResolution(currentAgent));

  const POLICY_SEGMENTS: { id: ToolPolicy; label: string; activeClass: string }[] = [
    { id: "off", label: "Off", activeClass: SEGMENT_ACTIVE_CLASS.off },
    { id: "ask", label: "Ask", activeClass: SEGMENT_ACTIVE_CLASS.conditional },
    { id: "allow", label: "Allow", activeClass: SEGMENT_ACTIVE_CLASS.enabled },
    { id: "custom", label: "Custom", activeClass: SEGMENT_ACTIVE_CLASS.custom },
  ];

  const PARAMS_RESOLUTION_SEGMENTS: { id: boolean | null; label: string; activeClass: string }[] = [
    { id: null, label: "Per-tool", activeClass: SEGMENT_ACTIVE_CLASS.conditional },
    { id: true, label: "Always", activeClass: SEGMENT_ACTIVE_CLASS.enabled },
    { id: false, label: "Never", activeClass: SEGMENT_ACTIVE_CLASS.off },
  ];

  function setAgentSeparateParamsResolution(value: boolean | null): void {
    if (!canEdit) return;
    onAgentChange(patchAgentSeparateParamsResolution(currentAgent, value));
  }

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

  function setPolicy(toolName: string, policy: ToolPolicy): void {
    if (!canEdit) return;
    patchTool(toolName, { policy });
    if (policy === "off") {
      toggleExpanded(toolName, false);
      return;
    }
    // Seed the tool's default rules the first time it's switched on.
    if (Object.keys(getToolConfig(toolName).config).length === 0) {
      const defaults = getToolDefaultConfig(toolCatalog, toolName);
      if (Object.keys(defaults).length > 0) patchTool(toolName, { config: defaults });
    }
    if (policy === "custom") toggleExpanded(toolName, true);
  }

  function policyTitle(id: ToolPolicy): string {
    return TOOL_POLICIES.find((p) => p.value === id)?.hint ?? "";
  }
</script>

<div class="mt-3.5">
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="text-[13px] font-bold text-foreground">Tools</div>
    <div
      class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title="Overrides every tool's own 'Separate params resolution' setting. Per-tool defers to each tool's individual flag."
    >
      Params resolution
      <div
        class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
        role="group"
        aria-label="Agent-wide params resolution override"
      >
        {#each PARAMS_RESOLUTION_SEGMENTS as seg, i (String(seg.id))}
          {@const active = agentSeparateParamsResolution === seg.id}
          <button
            type="button"
            class="px-1.5 py-0.5 transition-colors {i > 0 ? 'border-l border-border' : ''} {active
              ? seg.activeClass
              : 'text-muted-foreground hover:bg-secondary/80'}"
            aria-pressed={active}
            disabled={!canEdit}
            onclick={() => setAgentSeparateParamsResolution(seg.id)}
          >
            {seg.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <table
    class="w-full border-collapse overflow-hidden rounded-[10px] border border-border text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-muted-foreground"
  >
    <thead>
      <tr>
        <th>Tool</th>
        <th>Description</th>
        <th title="Off · Ask · Allow · Custom (defer to the tool)">Permission</th>
      </tr>
    </thead>
    <tbody>
      {#each toolCatalog as raw (String(raw.name ?? ""))}
        {@const row = raw as Record<string, unknown>}
        {@const name = String(row.name ?? "").trim()}
        {#if name}
          {@const cfg = getToolConfig(name)}
          {@const on = cfg.policy !== "off"}
          {@const expanded = !!expandedTools[name] && on}
          <tr>
            <td>
              {#if on}
                <button
                  type="button"
                  class="-mx-1 inline-flex items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left hover:bg-muted disabled:cursor-default"
                  disabled={!canEdit}
                  onclick={() => toggleExpanded(name)}
                  aria-expanded={expanded}
                >
                  {#if expanded}
                    <Icon name="chevron-down" class="h-3.5 w-3.5 text-muted-foreground" />
                  {:else}
                    <Icon name="chevron-right" class="h-3.5 w-3.5 text-muted-foreground" />
                  {/if}
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
              <div
                class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
                role="group"
                aria-label="{name} permission policy"
              >
                {#each POLICY_SEGMENTS as seg, i (seg.id)}
                  {@const active = cfg.policy === seg.id}
                  <button
                    type="button"
                    class="px-1.5 py-0.5 transition-colors {i > 0 ? 'border-l border-border' : ''} {active
                      ? seg.activeClass
                      : 'text-muted-foreground hover:bg-secondary/80'}"
                    aria-pressed={active}
                    disabled={!canEdit}
                    title={policyTitle(seg.id)}
                    onclick={() => setPolicy(name, seg.id)}
                  >
                    {seg.label}
                  </button>
                {/each}
              </div>
            </td>
          </tr>
          {#if expanded}
            <tr>
              <td colspan="3" class="bg-muted/50">
                <div class="p-2">
                  <ToolRulesEditor
                    toolName={name}
                    config={cfg}
                    rulesSchema={toolRulesZodSchemas.get(name)}
                    {guardrailLlmConfigured}
                    globalGuardrailPrompt={guardrailLlm.system_prompt}
                    {agentSeparateParamsResolution}
                    readOnly={!canEdit}
                    rulesEditorHeight={200}
                    onPatch={(patch) => patchTool(name, patch)}
                  />
                </div>
              </td>
            </tr>
          {/if}
        {/if}
      {/each}
    </tbody>
  </table>
</div>
