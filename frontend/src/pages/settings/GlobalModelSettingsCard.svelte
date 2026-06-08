<script lang="ts">
  import type { LlmSettings } from "@/types/llmSettings";
  import type { ModelGroup } from "./helpers";
  import ModelGroupSelect from "./ModelGroupSelect.svelte";

  let {
    settings,
    modelGroups,
    onSettingsChange,
  }: {
    settings: LlmSettings;
    modelGroups: ModelGroup[];
    onSettingsChange: (next: LlmSettings) => void;
  } = $props();

  const titleModelSet = $derived(!!settings.llm_configuration?.title_model_name);
</script>

<div class="rounded-lg border border-border bg-card">
  <div class="border-b border-border px-4 py-3">
    <div class="text-[14px] font-bold">Global model settings</div>
    <div class="mt-0.5 text-[12px] text-muted-foreground">
      Defaults used when an agent doesn't specify its own model.
    </div>
  </div>
  <div class="grid grid-cols-1 gap-px bg-border md:grid-cols-3">
    <div class="bg-card p-4">
      <div class="flex flex-col gap-1">
        <div class="text-[13px] font-semibold text-foreground">Reasoning model</div>
        <div class="mb-1 text-[12px] leading-snug text-muted-foreground">Used for agent responses and planning.</div>
        <ModelGroupSelect
          value={settings.llm_configuration?.model_name || ""}
          groups={modelGroups}
          placeholder="Select model"
          onchange={(nextValue, providerId) => {
            const next = structuredClone(settings);
            next.llm_configuration.model_name = nextValue;
            if (providerId?.trim()) next.llm_configuration.provider_id = providerId.trim();
            onSettingsChange(next);
          }}
        />
      </div>
    </div>
    <div class="bg-card p-4">
      <div class="flex flex-col gap-1">
        <div class="text-[13px] font-semibold text-foreground">Title model</div>
        <div class="mb-1 text-[12px] leading-snug text-muted-foreground">Auto-generates conversation titles.</div>
        <ModelGroupSelect
          value={String(settings.llm_configuration?.title_model_name || "")}
          groups={modelGroups}
          placeholder="Same as reasoning model"
          onchange={(nextValue, providerId) => {
            const next = structuredClone(settings);
            next.llm_configuration.title_model_name = nextValue || undefined;
            next.llm_configuration.title_provider_id = nextValue
              ? providerId?.trim() || next.llm_configuration.title_provider_id
              : undefined;
            onSettingsChange(next);
          }}
        />
        {#if titleModelSet}
          <button
            type="button"
            class="mt-1.5 text-left text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onclick={() => {
              const next = structuredClone(settings);
              next.llm_configuration.title_model_name = undefined;
              next.llm_configuration.title_provider_id = undefined;
              onSettingsChange(next);
            }}
          >
            Reset to reasoning model
          </button>
        {/if}
      </div>
    </div>
    <div class="bg-card p-4">
      <div class="flex flex-col gap-1">
        <div class="text-[13px] font-semibold text-foreground">Embedding model</div>
        <div class="mb-1 text-[12px] leading-snug text-muted-foreground">Used for memory and retrieval (future).</div>
        <ModelGroupSelect
          value={String(settings.llm_configuration?.model_settings?.embedding_model || "")}
          groups={modelGroups}
          placeholder="Select model"
          onchange={(nextValue) => {
            const next = structuredClone(settings);
            next.llm_configuration.model_settings = {
              ...next.llm_configuration.model_settings,
              embedding_model: nextValue,
            };
            onSettingsChange(next);
          }}
        />
      </div>
    </div>
  </div>
</div>
