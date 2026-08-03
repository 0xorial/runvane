<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import ToolRulesEditor from "@/components/settings/ToolRulesEditor.svelte";
  import ToolClearView from "@/components/settings/ToolClearView.svelte";
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
  import { deriveEffectTags, deriveSignature, type EffectTag } from "./toolFacets";
  import { buildToolRulesZodSchemas } from "./toolRulesSchemas";

  // Effect tags flag notable effects (deletes / runs code / network), styled by
  // risk. Read/write aren't tagged — every file tool does both, so no signal.
  const TAG_CLASS: Record<EffectTag["kind"], string> = {
    delete: "bg-red-500/10 text-red-600",
    exec: "bg-orange-500/10 text-orange-600",
    network: "bg-blue-500/10 text-blue-600",
  };

  // The rules the tool actually runs with: catalog defaults overlaid with the
  // agent's configured overrides — what Safety/Limits read from.
  function effectiveRules(raw: Record<string, unknown>, cfg: ToolConfig): Record<string, unknown> {
    return { ...getToolDefaultConfig(toolCatalog, String(raw.name ?? "")), ...cfg.config };
  }

  function effectTags(raw: Record<string, unknown>, cfg: ToolConfig): EffectTag[] {
    const { operations } = deriveSignature(raw.params_schema);
    return deriveEffectTags(String(raw.name ?? ""), operations, effectiveRules(raw, cfg), String(raw.location ?? ""));
  }

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

  // Grouped by execution location so the trust boundary is visible while
  // configuring: harness tools run centrally; target tools run inside the
  // conversation's bound sandbox (and are unavailable under sandbox "none").
  const TOOL_SECTIONS = [
    { location: "harness", label: "Harness tools", hint: "Run centrally in the backend." },
    {
      location: "target",
      label: "Target sandbox tools",
      hint: "Run inside the conversation's bound sandbox; unavailable when the sandbox is “none”.",
    },
  ] as const;
  const sectionedCatalog = $derived(
    TOOL_SECTIONS.map((section) => ({
      ...section,
      rows: toolCatalog.filter((raw) => {
        const loc = (raw as Record<string, unknown>).location;
        return section.location === "target" ? loc === "target" : loc !== "target";
      }),
    })).filter((section) => section.rows.length > 0),
  );

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
    // Expansion is inspection, decoupled from the on/off policy — turning a tool
    // off no longer hides its clear view; it just stops seeding/auto-expanding.
    if (policy === "off") return;
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
    {#each sectionedCatalog as section (section.location)}
      <tbody data-testid="tool-section-{section.location}">
        <tr>
          <td
            colspan="3"
            class="bg-secondary/60 text-[10px] font-bold uppercase tracking-wide {section.location === 'target'
              ? 'text-teal-600'
              : 'text-violet-600'}"
          >
            {section.label}
            <span class="ml-2 font-normal normal-case tracking-normal text-muted-foreground">{section.hint}</span>
          </td>
        </tr>
        {#each section.rows as raw (String(raw.name ?? ""))}
        {@const row = raw as Record<string, unknown>}
        {@const name = String(row.name ?? "").trim()}
        {#if name}
          {@const cfg = getToolConfig(name)}
          {@const on = cfg.policy !== "off"}
          {@const expanded = !!expandedTools[name]}
          {@const tags = effectTags(row, cfg)}
          <tr>
            <td>
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
                <code class={on ? "" : "text-muted-foreground"}>{name}</code>
              </button>
            </td>
            <td class="max-w-[360px] text-muted-foreground">
              {#if tags.length > 0}
                <div class="mb-1 flex flex-wrap gap-1" data-testid="tool-effect-tags">
                  {#each tags as tag (tag.kind)}
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium {tag.muted
                        ? 'bg-muted text-muted-foreground'
                        : TAG_CLASS[tag.kind]}"
                    >
                      {tag.label}
                    </span>
                  {/each}
                </div>
              {/if}
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
                <div class="space-y-3 p-2">
                  <ToolClearView
                    toolName={name}
                    paramsSchema={row.params_schema}
                    effectiveRules={effectiveRules(row, cfg)}
                    policy={cfg.policy}
                  />
                  {#if on}
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
                  {/if}
                </div>
              </td>
            </tr>
          {/if}
        {/if}
        {/each}
      </tbody>
    {/each}
  </table>
</div>
