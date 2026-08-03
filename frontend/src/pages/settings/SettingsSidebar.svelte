<script lang="ts">
  import type { SettingsSection } from "./helpers";
  import { settingsNavBtn, settingsNavBtnActive } from "./settingsClasses";

  // Grouped by the object model, in setup order: models feed everything,
  // agents are who you talk to, execution is where tools act, knowledge is
  // what agents can look up. Slugs are stable — only grouping/labels here.
  const NAV_GROUPS: ReadonlyArray<{
    label: string | null;
    items: ReadonlyArray<{ section: SettingsSection; label: string }>;
  }> = [
    { label: null, items: [{ section: "overview", label: "Overview" }] },
    {
      label: "Models",
      items: [
        { section: "model-providers", label: "Providers" },
        { section: "model-presets", label: "Presets" },
        { section: "model-pricing", label: "Pricing" },
      ],
    },
    { label: "Agents", items: [{ section: "agents", label: "Agents" }] },
    {
      label: "Execution",
      items: [
        { section: "tools", label: "Tools" },
        { section: "tool-sandboxes", label: "Sandboxes" },
      ],
    },
    { label: "Knowledge", items: [{ section: "knowledge", label: "Knowledge bases" }] },
    { label: "System", items: [{ section: "system", label: "System" }] },
    { label: "Help", items: [{ section: "learn", label: "Tutorial" }] },
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

<aside class="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
  {#each NAV_GROUPS as group (group.label ?? "top")}
    <div>
      {#if group.label}
        <div class="mb-0.5 mt-2.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.label}
        </div>
      {/if}
      {#each group.items as item (item.section)}
        <button
          type="button"
          class="{settingsNavBtn} {activeSection === item.section ? settingsNavBtnActive : ''}"
          onclick={() => onNavigate(item.section)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/each}
</aside>
