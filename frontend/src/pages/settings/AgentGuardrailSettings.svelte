<script lang="ts">
  import { DEFAULT_GUARDRAIL_PROMPT } from "../../../../backend/src/contracts/guardrail";
  import type { GuardrailConfig } from "./agentGuardrail";
  import type { ModelGroup } from "./helpers";
  import ModelGroupSelect from "./ModelGroupSelect.svelte";

  let {
    config,
    canEdit,
    modelGroups,
    onchange,
  }: {
    config: GuardrailConfig;
    canEdit: boolean;
    modelGroups: ModelGroup[];
    onchange: (patch: Partial<GuardrailConfig>) => void;
  } = $props();
</script>

<div class="mt-3.5">
  <div class="mb-1 text-[13px] font-bold text-foreground">Guardrail LLM</div>
  <p class="mb-2.5 text-xs text-muted-foreground">
    When enabled per-tool, this LLM reviews each call before it runs. A flagged call pauses for your approval with the guardrail's reason shown.
  </p>
  <label class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
    Model
    <div class="ml-1.5 min-w-[260px] flex-1">
      <ModelGroupSelect
        value={config.model_name}
        groups={modelGroups}
        disabled={!canEdit}
        placeholder="Select guardrail model"
        onchange={(model, providerId) => onchange({ model_name: model, provider_id: providerId ?? "" })}
      />
    </div>
  </label>
  <label class="mt-2 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
    What to flag
    <textarea
      class="min-h-[90px] w-full resize-y rounded-[10px] border border-input bg-background px-2.5 py-2 text-[13px] leading-snug"
      value={config.system_prompt}
      disabled={!canEdit}
      oninput={(e) => onchange({ system_prompt: e.currentTarget.value })}
      placeholder={DEFAULT_GUARDRAIL_PROMPT}
      rows={4}
      spellcheck={false}
    ></textarea>
  </label>
</div>
