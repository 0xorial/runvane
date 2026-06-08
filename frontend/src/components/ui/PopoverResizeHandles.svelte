<script lang="ts">
  import type { PopoverResizeEdge } from "@/lib/popoverResize";

  let { onResize }: { onResize: (edge: PopoverResizeEdge, event: MouseEvent) => void } = $props();

  const edges: { edge: PopoverResizeEdge; class: string }[] = [
    { edge: "n", class: "left-2 right-2 top-0 h-2 cursor-ns-resize" },
    { edge: "s", class: "bottom-0 left-2 right-2 h-2 cursor-ns-resize" },
    { edge: "e", class: "bottom-2 right-0 top-2 w-2 cursor-ew-resize" },
    { edge: "w", class: "bottom-2 left-0 top-2 w-2 cursor-ew-resize" },
    { edge: "nw", class: "left-0 top-0 h-4 w-4 cursor-nwse-resize" },
    { edge: "ne", class: "right-0 top-0 h-4 w-4 cursor-nesw-resize" },
    { edge: "sw", class: "bottom-0 left-0 h-4 w-4 cursor-nesw-resize" },
    { edge: "se", class: "bottom-0 right-0 h-4 w-4 cursor-nwse-resize" },
  ];
</script>

{#each edges as { edge, class: edgeClass }}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute z-20 rounded-sm hover:bg-primary/20 {edgeClass}"
    onmousedown={(event) => onResize(edge, event)}
  ></div>
{/each}
