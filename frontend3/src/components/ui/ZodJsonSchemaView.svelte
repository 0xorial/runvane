<script lang="ts">
  import CodeEditor from "./CodeEditor.svelte";
  import Icon from "./Icon.svelte";

  let { schemaText }: { schemaText: string } = $props();

  let open = $state(false);
  const lineCount = $derived(schemaText.split("\n").length);
  const viewHeight = $derived(Math.min(Math.max(lineCount * 18, 80), 360));
</script>

<div class="rounded-md border border-border/60 bg-muted/40 text-xs">
  <button
    type="button"
    class="flex w-full items-center gap-1 px-2.5 py-1.5 text-left font-semibold text-foreground"
    onclick={() => (open = !open)}
  >
    {#if open}
      <Icon name="chevron-down" class="h-3.5 w-3.5" />
    {:else}
      <Icon name="chevron-right" class="h-3.5 w-3.5" />
    {/if}
    <span>Schema</span>
    <span class="font-normal text-muted-foreground">(JSON Schema)</span>
  </button>
  {#if open}
    <div class="px-2.5 pb-2">
      <CodeEditor value={schemaText} language="json" height={viewHeight} readOnly />
    </div>
  {/if}
</div>
