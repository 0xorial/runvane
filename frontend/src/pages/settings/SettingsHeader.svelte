<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import type { SettingsSection } from "./helpers";

  const SECTION_TITLES: Record<SettingsSection, string> = {
    "model-providers": "Model Providers",
    "model-presets": "Model Presets",
    "model-pricing": "Model Pricing",
    agents: "Agents",
    tools: "Tools",
    skills: "Skills",
    rag: "RAG",
  };

  let {
    activeSection,
    providerSearch = "",
    onProviderSearchChange,
  }: {
    activeSection: SettingsSection;
    providerSearch?: string;
    onProviderSearchChange?: (value: string) => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3 md:px-3.5">
  <div class="text-sm font-extrabold">{SECTION_TITLES[activeSection]}</div>
  {#if activeSection === "model-providers" && onProviderSearchChange}
    <div class="flex items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-2.5 py-2">
      <input
        class="min-w-[180px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder="Search providers or ids"
        value={providerSearch}
        oninput={(e) => onProviderSearchChange(e.currentTarget.value)}
      />
      {#if providerSearch}
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent text-sm leading-none text-muted-foreground"
          aria-label="Clear search"
          onclick={() => onProviderSearchChange("")}
        >
          <Icon name="x" class="h-4 w-4" />
        </button>
      {/if}
    </div>
  {/if}
</div>
