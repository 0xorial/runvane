<script lang="ts">
  import { Pane, PaneGroup, type PaneAPI } from "paneforge";
  import type { Snippet } from "svelte";
  import ResizablePaneHandle from "./ResizablePaneHandle.svelte";

  let {
    open,
    onOpenChange,
    side,
    children,
    defaultSize = 20,
    minSize = 14,
    maxSize,
    sideClass = "",
    mainClass = "",
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    side: Snippet;
    children: Snippet;
    defaultSize?: number;
    minSize?: number;
    maxSize?: number;
    sideClass?: string;
    mainClass?: string;
  } = $props();

  let sidePane: PaneAPI | undefined = $state();

  const mainMinSize = $derived(typeof maxSize === "number" ? Math.max(0, 100 - maxSize) : 0);

  $effect(() => {
    if (!sidePane) return;
    if (open && sidePane.isCollapsed()) sidePane.expand();
    else if (!open && !sidePane.isCollapsed()) sidePane.collapse();
  });
</script>

<PaneGroup direction="horizontal" class="h-full min-h-0 w-full">
  <Pane
    bind:this={sidePane}
    {defaultSize}
    {minSize}
    {...typeof maxSize === "number" ? { maxSize } : {}}
    collapsible
    collapsedSize={0}
    onExpand={() => onOpenChange(true)}
    onCollapse={() => onOpenChange(false)}
    class="h-full min-h-0 min-w-0 overflow-hidden {sideClass}"
  >
    {@render side()}
  </Pane>
  <ResizablePaneHandle withHandle visible={open} />
  <Pane
    minSize={mainMinSize}
    class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden {mainClass}"
  >
    {@render children()}
  </Pane>
</PaneGroup>
