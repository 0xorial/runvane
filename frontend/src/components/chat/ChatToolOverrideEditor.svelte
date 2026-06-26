<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { AgentToolConfig } from "../../../../backend/src/agents/agent.entity";
  import { getTools } from "@/api/client";
  import ToolRulesEditor from "@/components/settings/ToolRulesEditor.svelte";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import PopoverResizeHandles from "@/components/ui/PopoverResizeHandles.svelte";
  import { beginPopoverResize, type PopoverLayout, type PopoverResizeEdge } from "@/lib/popoverResize";
  import { portal } from "@/lib/portal";
  import { agentIdFromSearch } from "@/lib/router";
  import {
    chatToolDraftRevision,
    getToolDraftEntry,
    setSelectedToolForEdit,
    setToolDraftCustom,
  } from "@/lib/chatToolDraft.svelte";
  import { readGuardrailConfig } from "@/pages/settings/agentGuardrail";
  import {
    getToolConfigFromAgent,
    getToolDefaultConfig,
    patchToolConfigOnAgent,
    type ToolConfig,
  } from "@/pages/settings/agentTools";
  import { buildToolRulesZodSchemas } from "@/pages/settings/toolRulesSchemas";

  const POPUP_GAP = 8;
  const DEFAULT_WIDTH = 560;
  const DEFAULT_HEIGHT = 480;
  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 320;
  // Initial height of the rules editor. It is independent of the popup size:
  // resizing the popup does not change it; the editor has its own drag handle.
  const RULES_EDITOR_INITIAL_HEIGHT = 280;

  let {
    search,
    toolName,
    anchor,
  }: {
    search: string;
    toolName: string;
    anchor: HTMLElement;
  } = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let panelPos = $state({ left: 0, top: 0 });
  let panelSize = $state({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  let layoutReady = $state(false);
  let isResizing = $state(false);

  const panelLayout = $derived({
    left: panelPos.left,
    top: panelPos.top,
    width: panelSize.width,
    height: panelSize.height,
  });

  const agentsQuery = createAgentsQuery();
  const toolsQuery = createQuery(() => ({
    queryKey: queryKeys.tools,
    queryFn: getTools,
  }));

  const agentId = $derived.by(() => {
    const fromUrl = agentIdFromSearch(search);
    if (fromUrl) return fromUrl;
    const agents = agentsQuery.data ?? [];
    return agents.find((a) => a.is_default)?.id ?? agents[0]?.id ?? "";
  });
  const agent = $derived((agentsQuery.data ?? []).find((row) => row.id === agentId) ?? null);
  const toolCatalog = $derived(toolsQuery.data ?? []);
  const rulesSchemas = $derived(buildToolRulesZodSchemas(toolCatalog));

  const workingConfig = $derived.by((): ToolConfig | null => {
    void $chatToolDraftRevision;
    if (!agent) return null;
    const entry = getToolDraftEntry(toolName);
    if (entry.mode === "custom" && entry.custom) {
      return {
        policy: "custom",
        guardrail: entry.custom.guardrail === true,
        guardrail_system_prompt: entry.custom.guardrail_system_prompt ?? "",
        config:
          entry.custom.rules && typeof entry.custom.rules === "object" && !Array.isArray(entry.custom.rules)
            ? (entry.custom.rules as Record<string, unknown>)
            : getToolDefaultConfig(toolCatalog, toolName),
      };
    }
    const fromAgent = getToolConfigFromAgent(agent, toolName);
    const rules =
      Object.keys(fromAgent.config).length > 0
        ? fromAgent.config
        : getToolDefaultConfig(toolCatalog, toolName);
    return { ...fromAgent, policy: "custom", config: rules };
  });

  const guardrailLlm = $derived(
    agent ? readGuardrailConfig(agent.default_llm_configuration as Record<string, unknown>) : null,
  );

  function placeNearAnchor(rect: DOMRect, width: number, height: number): { left: number; top: number } {
    let left = rect.right + POPUP_GAP;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width - POPUP_GAP);
    }
    let top = rect.top;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.bottom - height);
    }
    return { left, top };
  }

  function initLayout(): void {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(DEFAULT_WIDTH, window.innerWidth - 24);
    const height = Math.min(DEFAULT_HEIGHT, window.innerHeight - 24);
    panelPos = placeNearAnchor(rect, width, height);
    panelSize = { width, height };
    layoutReady = true;
  }

  function syncPopupPosition(): void {
    if (isResizing) return;
    const rect = anchor.getBoundingClientRect();
    panelPos = placeNearAnchor(rect, panelSize.width, panelSize.height);
  }

  function close(): void {
    setSelectedToolForEdit(null);
  }

  function applyPanelLayout(layout: PopoverLayout): void {
    panelSize = { width: layout.width, height: layout.height };
    panelPos = { left: layout.left, top: layout.top };
  }

  function onResizeEdge(edge: PopoverResizeEdge, event: MouseEvent): void {
    isResizing = true;
    beginPopoverResize(
      event,
      edge,
      panelLayout,
      applyPanelLayout,
      { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT },
      () => {
        isResizing = false;
      },
    );
  }

  function toAgentToolConfig(cfg: ToolConfig): AgentToolConfig {
    return {
      policy: "custom",
      rules: cfg.config,
      guardrail: cfg.guardrail,
      ...(cfg.guardrail_system_prompt.trim() ? { guardrail_system_prompt: cfg.guardrail_system_prompt.trim() } : {}),
    };
  }

  function onPatch(patch: Parameters<typeof patchToolConfigOnAgent>[2]): void {
    if (!agent || !workingConfig) return;
    const nextAgent = patchToolConfigOnAgent(agent, toolName, patch);
    const nextCfg = getToolConfigFromAgent(nextAgent, toolName);
    setToolDraftCustom(toolName, toAgentToolConfig({ ...nextCfg, policy: "custom" }));
  }

  $effect(() => {
    initLayout();
    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor.contains(target) || panel?.contains(target)) return;
      close();
    }
    function onViewportChange(): void {
      syncPopupPosition();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  });
</script>

{#if workingConfig && guardrailLlm && layoutReady}
  <div
    use:portal
    bind:this={panel}
    class="fixed z-[1500] flex flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
    style:left="{panelPos.left}px"
    style:top="{panelPos.top}px"
    style:width="{panelSize.width}px"
    style:height="{panelSize.height}px"
    data-testid="chat-tool-override-editor"
    role="dialog"
    aria-label="Custom tool override for {toolName}"
  >
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span class="truncate text-xs font-semibold text-foreground">Custom · {toolName}</span>
      <button
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        onclick={close}
      >
        Close
      </button>
    </div>
    <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
      <ToolRulesEditor
        {toolName}
        config={workingConfig}
        rulesSchema={rulesSchemas.get(toolName)}
        guardrailLlmConfigured={guardrailLlm.provider_id.length > 0 && guardrailLlm.model_name.length > 0}
        globalGuardrailPrompt={guardrailLlm.system_prompt}
        rulesEditorHeight={RULES_EDITOR_INITIAL_HEIGHT}
        {onPatch}
      />
    </div>
    <PopoverResizeHandles onResize={onResizeEdge} />
  </div>
{/if}
