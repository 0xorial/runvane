<script lang="ts">
  import { fade } from "svelte/transition";
  import { createQuery } from "@tanstack/svelte-query";
  import { createAgentsQuery } from "@/hooks/queries/referenceData";
  import { getLlmProviderSettings, getToolSandboxes, getTools } from "@/api/client";
  import { getKnowledgeStorages } from "@/api/knowledgeClient";
  import { queryKeys } from "@/hooks/queries/keys";
  import { chatToolDraftRevision, getChatKnowledgeDraft } from "@/lib/chatToolDraft.svelte";
  import { getAgentLlm } from "@/pages/settings/agentLlm";
  import { computeLayoutMap, type LayoutMapInputs, type MapColor } from "./layoutMap";

  // The living map of the conversation being configured: who runs where (you →
  // machine → harness → tool-host/sandbox), which special tools depend on what,
  // and which models the harness talks to. Everything derives from the same
  // state the cards below edit, so a selection change re-lays-out the map and
  // CSS transitions animate the move.
  let { selectedAgentId, toolSandboxId }: { selectedAgentId: string; toolSandboxId: string } = $props();

  const agentsQuery = createAgentsQuery();
  const toolsQuery = createQuery(() => ({ queryKey: queryKeys.tools, queryFn: getTools }));
  const envQuery = createQuery(() => ({ queryKey: queryKeys.toolSandboxes, queryFn: getToolSandboxes }));
  const storagesQuery = createQuery(() => ({ queryKey: ["knowledge-storages"], queryFn: getKnowledgeStorages }));
  const llmDocQuery = createQuery(() => ({ queryKey: ["llm-provider-settings"], queryFn: getLlmProviderSettings }));

  const WEB_TOOL_IDS = ["web_search", "web_browse"];

  const agent = $derived.by(() => {
    const agents = agentsQuery.data ?? [];
    return agents.find((a) => a.id === selectedAgentId) ?? agents.find((a) => a.is_default) ?? agents[0] ?? null;
  });

  const enabledToolIds = $derived.by(() => {
    const tools = agent?.default_llm_configuration?.tools as Record<string, { policy?: string | null } | null> | undefined;
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([, cfg]) => cfg?.policy != null && cfg.policy !== "off")
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));
  });

  const targetToolIds = $derived(
    new Set((toolsQuery.data ?? []).filter((t) => t.location === "target").map((t) => t.name)),
  );

  const knowledgeDraft = $derived.by(() => {
    void $chatToolDraftRevision;
    return getChatKnowledgeDraft();
  });

  const inputs = $derived.by((): LayoutMapInputs | null => {
    if (!agent) return null;
    const special = new Set(["knowledge", ...WEB_TOOL_IDS]);
    const plainTools = enabledToolIds.filter((id) => !special.has(id) && !targetToolIds.has(id));
    const webTools = enabledToolIds.filter((id) => WEB_TOOL_IDS.includes(id));
    const hostTools = enabledToolIds.filter((id) => targetToolIds.has(id));

    const storages = storagesQuery.data ?? [];
    const sources = knowledgeDraft.enabled
      ? storages.filter((s) => knowledgeDraft.storages.includes(s.id)).map((s) => s.name)
      : [];

    const env = (envQuery.data ?? []).find((e) => e.id === toolSandboxId) ?? null;
    const sandbox = env
      ? {
          kind: env.kind,
          name: clip(env.name, 22),
          docker: env.docker != null,
          mounts: (env.docker?.mounts ?? []).map((m) => ({
            host: shortPath(m.host),
            container: shortPath(m.container),
            readonly: m.readonly,
          })),
          sshHost: env.ssh?.host,
        }
      : null;

    const chat = clip(getAgentLlm(agent).model.trim() || "not set", 24);
    const globalCfg = llmDocQuery.data?.llm_configuration;
    const title = clip(globalCfg?.title_model_name?.trim() || globalCfg?.model_name?.trim() || "not set", 24);
    const agentCfg = agent.default_llm_configuration as { tool_call_model_name?: string } | null;
    const toolCall = clip(agentCfg?.tool_call_model_name?.trim() || "same as chat", 24);

    return {
      agentName: clip(agent.name.trim() || "Untitled agent", 24),
      plainTools,
      ragOn: enabledToolIds.includes("knowledge"),
      webTools,
      sources,
      sandbox,
      hostTools,
      models: [
        { role: "chat model", name: chat, twoWay: true },
        { role: "title model", name: title },
        { role: "categorization model", name: title },
        { role: "tool-call model", name: toolCall },
      ],
    };
  });

  const layout = $derived(inputs ? computeLayoutMap(inputs) : null);

  function clip(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function shortPath(p: string): string {
    if (p.length <= 28) return p;
    const parts = p.split("/");
    let out = "";
    for (let i = parts.length - 1; i >= 0; i--) {
      const next = parts[i] + (out ? "/" + out : "");
      if (next.length > 24) break;
      out = next;
    }
    return "…/" + (out || p.slice(-24));
  }

  const STROKE: Record<MapColor, string> = {
    strong: "hsl(var(--foreground) / 0.4)",
    soft: "hsl(var(--border))",
    teal: "hsl(var(--success))",
    amber: "hsl(var(--warning))",
    dot: "hsl(var(--info))",
    text2: "hsl(var(--muted-foreground))",
    text3: "hsl(var(--muted-foreground) / 0.7)",
  };
  const FILL = {
    card: "hsl(var(--card))",
    sub: "hsl(var(--muted) / 0.45)",
    none: "none",
  } as const;

  function textFill(color?: MapColor): string | undefined {
    return color ? STROKE[color] : undefined;
  }
</script>

{#if layout}
  <div class="mx-auto w-full max-w-[648px]" data-testid="layout-map">
    <svg viewBox="0 0 {layout.width} {layout.height}" width="100%" role="img" aria-label="Where this conversation's pieces run">
      <defs>
        <marker id="lm-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" />
        </marker>
      </defs>

      {#each layout.rects.filter((r) => r.id !== "sb-pill") as r (r.id)}
        <rect
          class="lm-geo"
          transition:fade={{ duration: 150 }}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={r.rx}
          fill={FILL[r.fill]}
          stroke={STROKE[r.stroke]}
          stroke-width={r.strokeWidth ?? 1}
          data-testid={r.testid}
        />
      {/each}

      {#each layout.paths as p (p.id)}
        <path
          class="lm-link"
          transition:fade={{ duration: 150 }}
          d={p.d}
          style="d: path('{p.d}')"
          fill="none"
          stroke={STROKE[p.stroke]}
          stroke-width={p.strokeWidth ?? 1}
          marker-end={p.markerEnd ? "url(#lm-arr)" : undefined}
          marker-start={p.markerStart ? "url(#lm-arr)" : undefined}
        />
      {/each}

      {#each layout.rects.filter((r) => r.id === "sb-pill") as r (r.id)}
        <rect
          class="lm-geo"
          transition:fade={{ duration: 150 }}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={r.rx}
          fill={FILL[r.fill]}
          stroke={STROKE[r.stroke]}
          stroke-width={r.strokeWidth ?? 1}
        />
      {/each}

      {#each layout.glyphs as g (g.id)}
        <g
          class="lm-move"
          transition:fade={{ duration: 150 }}
          style="transform: translate({g.x}px, {g.y}px)"
          stroke={g.color ? STROKE[g.color] : STROKE.text3}
        >
          {#if g.kind === "wrench"}
            <path d="M8.4 2a2.6 2.6 0 0 1-3.4 3.4L2.6 7.8a1 1 0 0 1-1.4-1.4L3.6 4A2.6 2.6 0 0 1 7 .6L5.6 2l1.4 1.4L8.4 2z" fill="none" stroke-width="1.1" stroke-linejoin="round" />
          {:else if g.kind === "cylinder"}
            <g fill="none" stroke-width="1">
              <ellipse cx="5" cy="2.2" rx="5" ry="2.2" />
              <path d="M0 2.2V9c0 1.2 2.2 2.2 5 2.2S10 10.2 10 9V2.2" />
            </g>
          {:else if g.kind === "globe"}
            <g fill="none" stroke-width="1">
              <circle r="13" />
              <ellipse rx="5.85" ry="13" />
              <path d="M-13 0H13" />
              <path d="M-11.2 -6.5H11.2M-11.2 6.5H11.2" opacity=".55" />
            </g>
          {/if}
        </g>
      {/each}

      {#each layout.texts as t (t.id)}
        <text
          class="lm-move lm-{t.cls}"
          transition:fade={{ duration: 150 }}
          style="transform: translate({t.x}px, {t.y}px);{t.color ? ` fill: ${textFill(t.color)};` : ''}"
          text-anchor={t.anchor}
          dominant-baseline={t.baseline}
        >
          {#each t.spans as s, i (i)}
            <tspan class={s.cls ? `lm-${s.cls}` : undefined} style={s.color ? `fill: ${textFill(s.color)}` : undefined}>{s.text}</tspan>
          {/each}
        </text>
      {/each}

      {#each layout.dots as d (d.id)}
        <circle class="lm-geo" transition:fade={{ duration: 150 }} cx={d.x} cy={d.y} r={d.r} fill={STROKE[d.color]} />
      {/each}
    </svg>
  </div>
{/if}

<style>
  svg {
    display: block;
  }
  .lm-geo {
    transition:
      x 0.28s ease,
      y 0.28s ease,
      cx 0.28s ease,
      cy 0.28s ease,
      width 0.28s ease,
      height 0.28s ease;
  }
  .lm-link {
    transition: d 0.28s ease;
  }
  .lm-move {
    transition: transform 0.28s ease;
  }
  text {
    font-family: "Inter", sans-serif;
  }
  .lm-n {
    font-size: 12.5px;
    font-weight: 500;
    fill: hsl(var(--foreground));
  }
  .lm-r {
    font-size: 11.5px;
    font-weight: 400;
    fill: hsl(var(--muted-foreground));
  }
  .lm-v {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 400;
    fill: hsl(var(--foreground) / 0.75);
  }
  .lm-pl {
    font-size: 12px;
    font-weight: 500;
    fill: hsl(var(--foreground));
  }
  .lm-lab {
    font-size: 10.5px;
    font-weight: 400;
  }
</style>
