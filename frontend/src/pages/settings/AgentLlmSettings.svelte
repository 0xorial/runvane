<script lang="ts">
  import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
  import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
  import { getAgentLlm, patchAgentLlm } from "./agentLlm";
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
  {#if modelGroups.length === 0}
    <p class="mb-3 text-[13px] text-amber-700 dark:text-amber-400">
      Verify at least one provider (fetch models) to pick a model here.
    </p>
  {/if}
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
</div>
