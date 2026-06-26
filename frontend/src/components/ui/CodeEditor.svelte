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
    onEscapeShortcut,
    resizable = false,
    minHeight = 120,
    maxHeight = 800,
  }: {
    value: string;
    onchange?: (value: string) => void;
    language?: "json" | "markdown" | "plaintext";
    height?: number;
    readOnly?: boolean;
    jsonSchema?: object;
    onSubmitShortcut?: () => void;
    onEscapeShortcut?: () => void;
    resizable?: boolean;
    minHeight?: number;
    maxHeight?: number;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let loading = $state(true);
  let handle = $state<CodeEditorHandle | null>(null);
  let lastEmitted = $state("");

  // When resizable, the user owns the height via the drag handle below the
  // editor. The `height` prop only seeds the initial value — later changes to
  // it are ignored so the editor keeps its size when an outer container (e.g. a
  // resizable popup) changes size. The width always follows the container.
  // svelte-ignore state_referenced_locally -- intentional: seed once, then owned by the drag handle
  let draggedHeight = $state(height);
  const editorHeight = $derived(resizable ? draggedHeight : height);

  function onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = draggedHeight;
    function onMove(ev: MouseEvent): void {
      draggedHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + (ev.clientY - startY)));
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

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
        onEscapeShortcut,
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

<div class="overflow-hidden rounded border border-border/70" data-testid="code-editor">
  {#if loading}
    <div
      class="flex items-center justify-center bg-muted/40 text-[11px] text-muted-foreground"
      style:height="{editorHeight}px"
    >
      Loading editor…
    </div>
  {/if}
  <div bind:this={container} class:hidden={loading} style:height="{editorHeight}px"></div>
</div>
{#if resizable}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="group flex h-2.5 w-full shrink-0 cursor-ns-resize items-center justify-center"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize editor height"
    onmousedown={onResizeStart}
  >
    <div class="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60"></div>
  </div>
{/if}
