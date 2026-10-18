<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import { getAgentLlm, getPlannerReplyFormat, patchAgentLlm, patchPlannerReplyFormat } from "./agentLlm";
  import type { ModelGroup } from "./helpers";
  import ModelGroupSelect from "./ModelGroupSelect.svelte";

  let {
    agent,
    canEdit,
    modelGroups,
    presets,
    onchange,
  }: {
    agent: AgentListItemResponse;
    canEdit: boolean;
    modelGroups: ModelGroup[];
    presets: ModelPresetResponse[];
    onchange: (agent: AgentListItemResponse) => void;
  } = $props();

  const { model } = $derived(getAgentLlm(agent));
  const replyFormat = $derived(getPlannerReplyFormat(agent));
  const presetGroups = $derived<ModelGroup[]>([
    {
      id: "presets",
      label: "Presets",
      models: [
        { value: "", label: "No preset" },
        ...presets.map((p) => ({
          value: String(p.id),
          label: p.name.trim() || `Preset #${p.id}`,
        })),
      ],
    },
  ]);
</script>

<div class="relative z-[2] mb-5 overflow-visible">
  <label class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
    Default model
    <div class="ml-1.5 min-w-[260px] flex-1">
      <ModelGroupSelect
        value={model}
        groups={modelGroups}
        disabled={!canEdit}
        placeholder="Select model"
        onchange={(m, providerId) => {
          if (!canEdit) return;
          onchange(patchAgentLlm(agent, { provider_id: providerId ?? undefined, model: m }));
        }}
      />
    </div>
  </label>
  <label class="mt-2 flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
    Default preset
    <div class="ml-1.5 min-w-[260px] flex-1">
      <ModelGroupSelect
        value={agent.default_model_preset_id == null ? "" : String(agent.default_model_preset_id)}
        groups={presetGroups}
        disabled={!canEdit}
        placeholder="No preset"
        onchange={(value) => {
          if (!canEdit) return;
          const t = String(value || "").trim();
          onchange({
            ...agent,
            default_model_preset_id: /^\d+$/.test(t) ? Number(t) : null,
          });
        }}
      />
    </div>
  </label>
  <label class="mt-2 flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
    Planner reply format
    <select
      class="ml-1.5 min-w-[260px] flex-1 rounded-[10px] border border-input bg-background px-2.5 py-1.5 text-[13px] text-foreground"
      data-testid="agent-planner-reply-format"
      value={replyFormat}
      disabled={!canEdit}
      onchange={(e) => {
        if (!canEdit) return;
        onchange(patchPlannerReplyFormat(agent, e.currentTarget.value));
      }}
    >
      <option value="json">JSON reply protocol (default)</option>
      <option value="native">Native tool calls + plain text</option>
    </select>
  </label>
</div>
