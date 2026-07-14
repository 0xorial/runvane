<script lang="ts">
  import ModelDropdown from "@/components/ui/ModelDropdown.svelte";
  import type { ModelGroup } from "./helpers";

  let {
    value,
    groups,
    disabled = false,
    placeholder = "Select…",
    onchange,
  }: {
    value: string;
    groups: ModelGroup[];
    disabled?: boolean;
    placeholder?: string;
    onchange: (model: string, providerId: string | null) => void;
  } = $props();
</script>

<ModelDropdown
  {value}
  onChange={(model, providerId) => onchange(model, providerId ?? null)}
  {groups}
  {placeholder}
  searchPlaceholder="Search model"
  {disabled}
/>
{#if groups.length === 0}
  <p class="mt-1 text-[11px] text-amber-700 dark:text-amber-400" data-testid="no-models-hint">
    No verified models —
    <a href="/settings/model-providers" class="underline underline-offset-2">connect a provider</a> first.
  </p>
{/if}
