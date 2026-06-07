<script lang="ts">
  import type { ExplicitToolOverrideMode, ToolOverrideUiMode } from "@/lib/chatToolOverrides";

  let {
    mode,
    effectiveMode,
    onChange,
  }: {
    mode: ToolOverrideUiMode;
    effectiveMode: ExplicitToolOverrideMode;
    onChange: (mode: ToolOverrideUiMode) => void;
  } = $props();

  const options: { id: ExplicitToolOverrideMode; label: string; activeClass: string }[] = [
    { id: "off", label: "Off", activeClass: "bg-muted font-semibold text-foreground" },
    { id: "allow_all", label: "All", activeClass: "bg-orange-500/25 font-semibold text-orange-800 dark:text-orange-200" },
    { id: "custom", label: "Custom", activeClass: "bg-emerald-500/25 font-semibold text-emerald-800 dark:text-emerald-200" },
  ];

  const selected = $derived((mode === "inherit" ? effectiveMode : mode) as ExplicitToolOverrideMode);
  const inherited = $derived(mode === "inherit");
</script>

<div
  class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
  role="group"
  aria-label="Tool override mode"
>
  {#each options as opt, i (opt.id)}
    {@const active = selected === opt.id}
    <button
      type="button"
      class="px-1.5 py-0.5 transition-colors {i > 0 ? 'border-l border-border' : ''} {active
        ? opt.activeClass
        : 'text-muted-foreground hover:bg-secondary/80'}"
      aria-pressed={active}
      title={inherited && active ? "Current agent setting (pick another option to override for the next message)" : undefined}
      onclick={() => {
        if (inherited && opt.id === effectiveMode) return;
        if (!inherited && mode === opt.id) onChange("inherit");
        else onChange(opt.id);
      }}
    >
      {opt.label}
    </button>
  {/each}
</div>
