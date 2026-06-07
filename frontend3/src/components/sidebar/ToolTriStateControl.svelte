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

  const options: { id: ExplicitToolOverrideMode; label: string; activeClass: string; inheritedClass: string }[] = [
    { id: "off", label: "Off", activeClass: "bg-muted text-foreground", inheritedClass: "bg-muted/60 text-muted-foreground ring-1 ring-border" },
    { id: "allow_all", label: "All", activeClass: "bg-orange-500/20 text-orange-700 dark:text-orange-300", inheritedClass: "bg-orange-500/10 text-orange-600/80 dark:text-orange-300/70 ring-1 ring-orange-500/30" },
    { id: "custom", label: "Custom", activeClass: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300", inheritedClass: "bg-emerald-500/10 text-emerald-600/80 dark:text-emerald-300/70 ring-1 ring-emerald-500/30" },
  ];

  const highlighted = $derived(mode === "inherit" ? effectiveMode : mode);
  const inherited = $derived(mode === "inherit");
</script>

<div
  class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
  role="group"
  aria-label="Tool override mode"
>
  {#each options as opt (opt.id)}
    {@const active = highlighted === opt.id}
    <button
      type="button"
      class="px-1.5 py-0.5 transition-colors hover:bg-secondary/80 {active
        ? inherited
          ? opt.inheritedClass
          : opt.activeClass
        : 'text-muted-foreground'}"
      aria-pressed={active}
      title={inherited && active ? "From agent settings (click another option to override)" : undefined}
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
