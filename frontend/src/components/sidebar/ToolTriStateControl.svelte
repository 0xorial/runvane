<script lang="ts">
  import type { AgentToolConfig } from "../../../../backend/src/agents/agent.entity";
  import ChatToolOverrideEditor from "@/components/chat/ChatToolOverrideEditor.svelte";
  import {
    chatToolDraftRevision,
    getSelectedToolForEdit,
    getToolDraftEntry,
    setToolDraftCustom,
    setToolDraftMode,
    setSelectedToolForEdit,
  } from "@/lib/chatToolDraft.svelte";
  import type { ExplicitToolOverrideMode, ToolOverrideUiMode } from "@/lib/chatToolOverrides";
  import { SEGMENT_ACTIVE_CLASS } from "@/lib/segmentColors";

  let {
    toolName,
    effectiveMode,
    agentCustomSeed,
    search,
  }: {
    toolName: string;
    effectiveMode: ExplicitToolOverrideMode;
    agentCustomSeed?: AgentToolConfig;
    search: string;
  } = $props();

  let customAnchor = $state<HTMLButtonElement | null>(null);

  const mode = $derived.by((): ToolOverrideUiMode => {
    void $chatToolDraftRevision;
    return getToolDraftEntry(toolName).mode;
  });

  const editorOpen = $derived.by(() => {
    void $chatToolDraftRevision;
    return getSelectedToolForEdit() === toolName;
  });

  const options: { id: ExplicitToolOverrideMode; label: string; activeClass: string }[] = [
    { id: "off", label: "Off", activeClass: SEGMENT_ACTIVE_CLASS.off },
    { id: "ask", label: "Ask", activeClass: SEGMENT_ACTIVE_CLASS.conditional },
    { id: "allow", label: "Allow", activeClass: SEGMENT_ACTIVE_CLASS.enabled },
    { id: "custom", label: "Custom", activeClass: SEGMENT_ACTIVE_CLASS.custom },
  ];

  const selected = $derived((mode === "inherit" ? effectiveMode : mode) as ExplicitToolOverrideMode);
  const inherited = $derived(mode === "inherit");

  function openCustomEditor(anchor: HTMLButtonElement): void {
    customAnchor = anchor;
    setSelectedToolForEdit(toolName);
  }

  function applyMode(next: ToolOverrideUiMode, anchor?: HTMLButtonElement): void {
    if (next === "custom") {
      const entry = getToolDraftEntry(toolName);
      if (!entry.custom && agentCustomSeed) {
        setToolDraftCustom(toolName, agentCustomSeed);
      } else {
        setToolDraftMode(toolName, "custom");
      }
      if (anchor) openCustomEditor(anchor);
      return;
    }
    setToolDraftMode(toolName, next);
  }

  function onOptionClick(optId: ExplicitToolOverrideMode, event: MouseEvent): void {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    if (optId === "custom" && mode === "custom") {
      openCustomEditor(button);
      return;
    }
    if (!inherited && mode === optId) {
      applyMode("inherit");
      return;
    }
    applyMode(optId, optId === "custom" ? button : undefined);
  }
</script>

<div
  class="inline-flex overflow-hidden rounded-md border border-border text-[10px] font-medium"
  role="group"
  aria-label="Tool override mode"
>
  {#each options as opt, i (opt.id)}
    {@const active = selected === opt.id}
    <button
      type="button"
      class="px-1 py-0.5 transition-colors {i > 0 ? 'border-l border-border' : ''} {active
        ? opt.activeClass
        : 'text-muted-foreground hover:bg-secondary/80'}"
      aria-pressed={active}
      aria-expanded={opt.id === "custom" && editorOpen}
      title={inherited && active ? "Current agent setting (pick another option to override for the next message)" : undefined}
      onclick={(event) => onOptionClick(opt.id, event)}
    >
      {opt.label}
    </button>
  {/each}
</div>

{#if editorOpen && customAnchor}
  <ChatToolOverrideEditor {search} {toolName} anchor={customAnchor} />
{/if}
