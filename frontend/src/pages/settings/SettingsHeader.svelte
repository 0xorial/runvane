<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import HarnessToolsHint from "@/components/chat/HarnessToolsHint.svelte";
  import type { SettingsSection } from "./helpers";

  const SECTION_TITLES: Record<SettingsSection, string> = {
    overview: "Overview",
    system: "System",
    "model-providers": "Providers",
    "model-presets": "Model Presets",
    "model-pricing": "Model Pricing",
    agents: "Agents",
    tools: "Tools",
    "tool-sandboxes": "Tool Sandboxes",
    rag: "Knowledge bases",
  };

  // One sentence per section stating what the thing IS and what consumes it —
  // the settings UI carries the object model instead of assuming it.
  const SECTION_ROLES: Record<SettingsSection, string> = {
    overview: "How runvane fits together, with live setup state.",
    system: "Harness-wide defaults: global models for titles and summaries, conversation behavior.",
    "model-providers":
      "Model sources. Everything that picks a model — agents, knowledge bases, presets — picks from a connected provider.",
    "model-presets": "Reusable model parameter bundles agents and chats can reference.",
    "model-pricing": "Per-model token prices that power conversation cost estimates.",
    agents: "Who you talk to: a system prompt, a default model, and per-tool permissions.",
    tools: "The tool catalog. Which agent may use which tool is configured per agent.",
    "tool-sandboxes":
      "Where a conversation's target tools run. Harness host and None are built in; add ssh hosts to act on other machines. Picked per chat on the new-chat screen.",
    rag: "Semantic indexes the agent injects as context — via forced context injection in the composer, or the rag tool. Each needs an embedding model from a provider; attach them to an agent under Agents → Tools → rag.",
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
  <div class="min-w-0">
    <div class="flex items-center gap-1.5 text-sm font-extrabold">
      {SECTION_TITLES[activeSection]}
      {#if activeSection === "tool-sandboxes"}
        <HarnessToolsHint side="bottom" />
      {/if}
    </div>
    <p class="mt-0.5 text-xs text-muted-foreground">{SECTION_ROLES[activeSection]}</p>
  </div>
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
