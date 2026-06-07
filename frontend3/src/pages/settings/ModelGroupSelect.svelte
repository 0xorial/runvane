<script lang="ts">
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

  const selectedKey = $derived.by(() => {
    const raw = value.trim();
    if (!raw) return "";
    for (const group of groups) {
      for (const model of group.models) {
        const modelValue = typeof model === "string" ? model : model.value;
        if (modelValue === raw) return `${group.id}::${modelValue}`;
      }
    }
    return raw.includes("::") ? raw : "";
  });

  function onSelect(raw: string): void {
    if (!raw) {
      onchange("", null);
      return;
    }
    const [providerId, model] = raw.split("::");
    if (!providerId || !model) {
      onchange(raw, null);
      return;
    }
    onchange(model, providerId);
  }
</script>

<select
  class="flex min-h-[28px] w-full cursor-pointer appearance-none rounded-md border border-input bg-muted/40 px-2.5 py-1 text-sm text-foreground"
  {disabled}
  value={selectedKey}
  onchange={(e) => onSelect(e.currentTarget.value)}
>
  <option value="">{placeholder}</option>
  {#each groups as group (group.id)}
    <optgroup label={group.label}>
      {#each group.models as model (typeof model === "string" ? `${group.id}-${model}` : `${group.id}-${model.value}`)}
        {@const modelValue = typeof model === "string" ? model : model.value}
        {@const label = typeof model === "string" ? model : model.label}
        <option value="{group.id}::{modelValue}">{label}</option>
      {/each}
    </optgroup>
  {/each}
</select>
