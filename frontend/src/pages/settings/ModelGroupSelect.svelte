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
