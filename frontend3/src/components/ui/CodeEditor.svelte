<script lang="ts">
  import { onMount } from "svelte";
  import type { CodeEditorHandle } from "./monaco/mountCodeEditor";

  let {
    value,
    onchange,
    language = "json",
    height = 220,
    readOnly = false,
    jsonSchema,
    onSubmitShortcut,
  }: {
    value: string;
    onchange?: (value: string) => void;
    language?: "json" | "markdown" | "plaintext";
    height?: number;
    readOnly?: boolean;
    jsonSchema?: object;
    onSubmitShortcut?: () => void;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let loading = $state(true);
  let handle = $state<CodeEditorHandle | null>(null);
  let lastEmitted = $state("");

  onMount(() => {
    let cancelled = false;
    void (async () => {
      if (!container) return;
      const { mountCodeEditor } = await import("./monaco/mountCodeEditor");
      if (cancelled || !container) return;
      handle = await mountCodeEditor(container, {
        value,
        language,
        readOnly,
        jsonSchema,
        onChange: (next) => {
          lastEmitted = next;
          onchange?.(next);
        },
        onSubmitShortcut,
      });
      loading = false;
    })();
    return () => {
      cancelled = true;
      handle?.dispose();
      handle = null;
    };
  });

  $effect(() => {
    if (!handle || value === lastEmitted || value === handle.getValue()) return;
    lastEmitted = value;
    handle.setValue(value);
  });

  $effect(() => {
    handle?.setReadOnly(readOnly);
  });

  $effect(() => {
    handle?.updateJsonSchema(jsonSchema);
  });
</script>

<div class="overflow-hidden rounded border border-border/70">
  {#if loading}
    <div
      class="flex items-center justify-center bg-muted/40 text-[11px] text-muted-foreground"
      style:height="{height}px"
    >
      Loading editor…
    </div>
  {/if}
  <div bind:this={container} class:hidden={loading} style:height="{height}px"></div>
</div>
