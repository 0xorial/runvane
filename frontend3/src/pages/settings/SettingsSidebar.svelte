<script lang="ts">
  import type { SettingsSection } from "./helpers";

  const NAV_ITEMS: ReadonlyArray<{ section: SettingsSection; label: string }> = [
    { section: "model-providers", label: "Model Providers" },
    { section: "model-presets", label: "Model Presets" },
    { section: "model-pricing", label: "Model Pricing" },
    { section: "tools", label: "Tools" },
    { section: "skills", label: "Skills" },
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
        class="mb-1.5 w-full rounded-[10px] border px-2.5 py-2.5 text-left text-sm transition-colors {activeSection === item.section
          ? 'border-primary/40 bg-primary/10'
          : 'border-transparent hover:border-primary/30 hover:bg-primary/[0.07]'}"
        onclick={() => onNavigate(item.section)}
      >
        {item.label}
      </button>
    {/each}
  </div>
</aside>
