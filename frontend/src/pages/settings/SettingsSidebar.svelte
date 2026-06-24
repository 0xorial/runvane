<script lang="ts">
  import type { SettingsSection } from "./helpers";
  import { settingsNavBtn, settingsNavBtnActive } from "./settingsClasses";

  const NAV_ITEMS: ReadonlyArray<{ section: SettingsSection; label: string }> = [
    { section: "model-providers", label: "Model Providers" },
    { section: "model-presets", label: "Model Presets" },
    { section: "model-pricing", label: "Model Pricing" },
    { section: "tools", label: "Tools" },
    { section: "skills", label: "Skills" },
    { section: "rag", label: "RAG" },
    { section: "tool-environments", label: "Tool Environments" },
    { section: "agents", label: "Agents" },
  ];

  let {
    activeSection,
    settingsSearch = "",
    onNavigate,
  }: {
    activeSection: SettingsSection;
    settingsSearch?: string;
    onNavigate: (section: SettingsSection) => void;
  } = $props();
</script>

<aside class="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-3">
  <div>
    <div class="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">WORKSPACE</div>
    {#each NAV_ITEMS as item (item.section)}
      <button
        type="button"
        class="{settingsNavBtn} {activeSection === item.section ? settingsNavBtnActive : ''}"
        onclick={() => onNavigate(item.section)}
      >
        {item.label}
      </button>
    {/each}
  </div>
</aside>
