<script lang="ts">
  import CollapsibleBlock from "@/components/ui/CollapsibleBlock.svelte";

  let {
    label,
    value,
    danger = false,
  }: {
    label: string;
    value: string;
    danger?: boolean;
  } = $props();
</script>

{#if value}
  <div class="space-y-0.5">
    <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
    <CollapsibleBlock>
      <pre
        class="whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px] {danger
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border/50 bg-muted/40 text-foreground/90'}"
      >{value}</pre>
    </CollapsibleBlock>
  </div>
{/if}
