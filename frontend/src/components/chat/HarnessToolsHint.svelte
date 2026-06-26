<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import HintTooltip from "@/components/ui/HintTooltip.svelte";

  let { side = "bottom" }: { side?: "top" | "bottom" } = $props();

  // Built dynamically from the tool catalog: tools whose location is the harness
  // run centrally (rag, conversations, api, …) no matter which tool sandbox a
  // conversation is bound to — they never cross the wire into the sandbox.
  const toolsQuery = createQuery(() => ({ queryKey: queryKeys.tools, queryFn: getTools }));
  const harnessTools = $derived(
    (toolsQuery.data ?? [])
      .filter((t) => t.location === "harness")
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b)),
  );
  const content = $derived(
    `Some tools always run in the harness sandbox, whichever tool sandbox you pick: ${harnessTools.join(", ")}.`,
  );
</script>

{#if harnessTools.length > 0}
  <HintTooltip {content} {side}>
    <span
      class="inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-current text-[9px] font-semibold leading-none text-muted-foreground"
      aria-label="Tools that always run in the harness sandbox"
      data-testid="harness-tools-hint"
      data-harness-tools={harnessTools.join(",")}
    >
      i
    </span>
  </HintTooltip>
{/if}
