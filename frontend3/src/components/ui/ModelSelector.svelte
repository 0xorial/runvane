<script lang="ts">
  import type { ModelGroup } from "@/pages/settings/helpers";
  import ModelDropdown from "./ModelDropdown.svelte";
  import type { Snippet } from "svelte";

  let {
    value,
    onChange,
    modelGroups,
    disabled = false,
    placeholder = "Select model",
    searchPlaceholder = "Search model",
    buttonClass = "",
    footer,
  }: {
    value: string;
    onChange: (model: string, providerId?: string) => void;
    modelGroups: ModelGroup[];
    disabled?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    buttonClass?: string;
    footer?: Snippet;
  } = $props();
</script>

<ModelDropdown
  {value}
  {onChange}
  groups={modelGroups}
  {disabled}
  {placeholder}
  {searchPlaceholder}
  {buttonClass}
  {footer}
/>
