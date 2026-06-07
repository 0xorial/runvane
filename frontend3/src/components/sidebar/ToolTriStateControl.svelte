<script lang="ts">
  import type { ToolOverrideUiMode } from "@/lib/chatToolOverrides";

  let {
    mode,
    onChange,
  }: {
    mode: ToolOverrideUiMode;
    onChange: (mode: ToolOverrideUiMode) => void;
  } = $props();

  const options: { id: Exclude<ToolOverrideUiMode, "inherit">; label: string; activeClass: string }[] = [
    { id: "off", label: "Off", activeClass: "bg-muted text-foreground" },
    { id: "allow_all", label: "All", activeClass: "bg-orange-500/20 text-orange-700 dark:text-orange-300" },
    { id: "custom", label: "Custom", activeClass: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  ];
</script>

<div
  class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
  role="group"
  aria-label="Tool override mode"
>
  {#each options as opt (opt.id)}
    <button
      type="button"
      class="px-1.5 py-0.5 transition-colors hover:bg-secondary/80 {mode === opt.id ? opt.activeClass : 'text-muted-foreground'}"
      aria-pressed={mode === opt.id}
      onclick={() => onChange(mode === opt.id ? "inherit" : opt.id)}
    >
      {opt.label}
    </button>
  {/each}
</div>
