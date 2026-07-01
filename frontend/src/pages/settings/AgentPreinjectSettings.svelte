<script lang="ts">
  import type { AgentPreinjectConfig } from "@/protocol/chatEntry";
  import { PREINJECT_FILE_TYPES, PREINJECT_FILE_TYPE_LABELS, PREINJECT_MODE_LABELS, type PreinjectFileType, type PreinjectMode } from "./agentPreinject";

  let {
    config,
    canEdit,
    onchange,
  }: {
    config: AgentPreinjectConfig;
    canEdit: boolean;
    onchange: (patch: Partial<AgentPreinjectConfig>) => void;
  } = $props();

  const MODES: readonly PreinjectMode[] = ["all", "selected", "none"];
  const selectedTypes = $derived(new Set(config.types ?? []));

  function setMode(mode: PreinjectMode): void {
    if (!canEdit) return;
    onchange({ mode });
  }

  function toggleType(fileType: PreinjectFileType): void {
    if (!canEdit) return;
    const next = new Set(selectedTypes);
    if (next.has(fileType)) next.delete(fileType);
    else next.add(fileType);
    onchange({ types: Array.from(next) });
  }
</script>

<div class="mt-3.5">
  <div class="mb-1 text-[13px] font-bold text-foreground">Context file preinjection</div>
  <p class="mb-2.5 text-xs text-muted-foreground">
    Before the first planner step of a new conversation, scan the workspace for common agent-context
    files (instructions, manifests, READMEs, lint configs, env samples) and fold them into the prompt.
    The discovered/injected files are recorded on a "context-injection" chat entry.
  </p>
  <div
    class="inline-flex overflow-hidden rounded-md border border-border text-[11px] font-medium"
    role="group"
    aria-label="Preinject mode"
  >
    {#each MODES as mode, i (mode)}
      {@const active = config.mode === mode}
      <button
        type="button"
        class="px-2.5 py-1 transition-colors {i > 0 ? 'border-l border-border' : ''} {active
          ? 'bg-primary/15 font-semibold text-primary'
          : 'text-muted-foreground hover:bg-secondary/80'}"
        aria-pressed={active}
        disabled={!canEdit}
        onclick={() => setMode(mode)}
      >
        {PREINJECT_MODE_LABELS[mode]}
      </button>
    {/each}
  </div>

  {#if config.mode === "selected"}
    <div class="mt-2 flex flex-col gap-1.5">
      {#each PREINJECT_FILE_TYPES as fileType (fileType)}
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={selectedTypes.has(fileType)}
            disabled={!canEdit}
            onchange={() => toggleType(fileType)}
          />
          {PREINJECT_FILE_TYPE_LABELS[fileType]}
        </label>
      {/each}
    </div>
  {/if}
</div>
