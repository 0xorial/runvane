import { useEffect, useMemo, useState } from "react";
import { Bot, Cpu, SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAgents, getLlmSettings, getModelPresets } from "../../api/client";
import { ModelDropdown } from "../ui/ModelDropdown";
import { ModelSelector } from "../ui/ModelSelector";
import { getAgentLlm } from "../../pages/settings/agentLlm";
import { buildModelGroups, sortAgents } from "../../pages/settings/helpers";
import type { ModelGroup } from "../../pages/settings/helpers";

export function agentIdFromSearchParams(searchParams: URLSearchParams): string {
  return searchParams.get("agent")?.trim() || "";
}

function presetIdFromSearchParams(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get("preset")?.trim() || "";
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type ChatAgentSelection = {
  agentId: string;
  llmProviderId: string;
  llmModel: string;
  modelPresetId: number | null;
};

type LlmSelection = {
  provider_id: string;
  model: string;
};

type ChatAgentToolbarProps = {
  onSelectionChange: (selection: ChatAgentSelection) => void;
  showAgent?: boolean;
  embedded?: boolean;
};

const toolbarLabelClass =
  "flex min-w-0 w-full flex-nowrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground";
const toolbarLabelEmbeddedClass = "flex min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground";
const embeddedDropdownButtonClass =
  "min-h-[24px] rounded-md border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-foreground shadow-none hover:bg-secondary/45 focus-visible:ring-1 focus-visible:ring-border";

export function ChatAgentToolbar({ onSelectionChange, showAgent = true, embedded = false }: ChatAgentToolbarProps) {
  const [urlParams, setUrlParams] = useSearchParams();
  const [allAgents, setAllAgents] = useState<AgentListItemResponse[] | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [allLlms, setAllLlms] = useState<ModelGroup[]>([]);
  const [selectedLlm, setSelectedLlm] = useState<LlmSelection | null>(null);
  const [allPresets, setAllPresets] = useState<ModelPresetResponse[] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(() => presetIdFromSearchParams(urlParams));

  useEffect(() => {
    getLlmSettings()
      .then((llm) => setAllLlms(buildModelGroups(llm.providers)))
      .catch(() => setAllLlms([]));
  }, []);

  useEffect(() => {
    getAgents()
      .then((rows) => setAllAgents(rows))
      .catch(() => setAllAgents([]));
  }, []);

  useEffect(() => {
    getModelPresets()
      .then((rows) => setAllPresets(rows))
      .catch(() => setAllPresets([]));
  }, []);

  useEffect(() => {
    if (allAgents == null) return;
    const raw = agentIdFromSearchParams(urlParams);
    if (!raw) {
      const fallbackId = allAgents[0]?.id ?? "";
      setSelectedAgentId(fallbackId);
      if (fallbackId) {
        setUrlParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("agent", fallbackId);
            return next;
          },
          { replace: true },
        );
      }
      return;
    }
    if (allAgents.length === 0) {
      setSelectedAgentId("");
      return;
    }
    if (allAgents.some((a) => a.id === raw)) {
      setSelectedAgentId(raw);
      return;
    }
    const nameHits = allAgents.filter((a) => a.name.trim() === raw);
    if (nameHits.length === 1) {
      const id = nameHits[0].id;
      setUrlParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("agent", id);
          return next;
        },
        { replace: true },
      );
      setSelectedAgentId(id);
      return;
    }
    const fallbackId = allAgents[0].id;
    setUrlParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("agent", fallbackId);
        return next;
      },
      { replace: true },
    );
    setSelectedAgentId(fallbackId);
  }, [urlParams, allAgents, setUrlParams]);

  useEffect(() => {
    const nextPresetId = presetIdFromSearchParams(urlParams);
    if (nextPresetId === selectedPresetId) return;
    setSelectedPresetId(nextPresetId);
  }, [urlParams, selectedPresetId]);

  function setAgentIdAndUrl(nextRaw: string) {
    const v = String(nextRaw ?? "");
    setSelectedAgentId(v);
    const t = v.trim();
    setUrlParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!t) next.delete("agent");
        else next.set("agent", t);
        return next;
      },
      { replace: true },
    );
  }

  function setPresetIdAndUrl(nextRaw: string) {
    const trimmed = String(nextRaw ?? "").trim();
    const nextPresetId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    setSelectedPresetId(nextPresetId);
    setUrlParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextPresetId == null) next.delete("preset");
        else next.set("preset", String(nextPresetId));
        return next;
      },
      { replace: true },
    );
  }

  const agentOptions = useMemo(() => sortAgents(allAgents || []), [allAgents]);
  const agentGroups: ModelGroup[] = useMemo(
    () => [
      {
        id: "agents",
        label: "",
        models: agentOptions.map((a) => ({
          value: a.id,
          label: a.name.trim() || a.id,
        })),
      },
    ],
    [agentOptions],
  );
  const currentAgent = useMemo(
    () => (allAgents || []).find((a) => a.id === selectedAgentId),
    [allAgents, selectedAgentId],
  );
  const agentDefaultLlm = useMemo(() => getAgentLlm(currentAgent), [currentAgent]);
  const firstAvailableLlm = useMemo<LlmSelection | null>(() => {
    for (const group of allLlms) {
      const first = group.models[0];
      if (first == null) continue;
      if (typeof first === "string") {
        const model = first.trim();
        if (!model) continue;
        return { provider_id: String(group.id || "").trim(), model };
      }
      const model = String(first.value || "").trim();
      if (!model) continue;
      return { provider_id: String(group.id || "").trim(), model };
    }
    return null;
  }, [allLlms]);

  const normalizedAgentDefault = useMemo<LlmSelection | null>(() => {
    const provider_id = String(agentDefaultLlm.provider_id || "").trim();
    const model = String(agentDefaultLlm.model || "").trim();
    if (provider_id && model) return { provider_id, model };
    return null;
  }, [agentDefaultLlm]);

  useEffect(() => {
    setSelectedLlm(normalizedAgentDefault ?? firstAvailableLlm);
  }, [selectedAgentId, normalizedAgentDefault, firstAvailableLlm]);

  useEffect(() => {
    if (selectedLlm && selectedLlm.provider_id && selectedLlm.model) return;
    if (normalizedAgentDefault) {
      setSelectedLlm(normalizedAgentDefault);
      return;
    }
    if (firstAvailableLlm) {
      setSelectedLlm(firstAvailableLlm);
    }
  }, [selectedLlm, normalizedAgentDefault, firstAvailableLlm]);

  const effectiveLlm: LlmSelection = selectedLlm ??
    normalizedAgentDefault ??
    firstAvailableLlm ?? { provider_id: "", model: "" };
  const presetGroups: ModelGroup[] = useMemo(
    () => [
      {
        id: "presets",
        label: "",
        models: (allPresets || []).map((p) => ({
          value: String(p.id),
          label: p.name.trim() || `Preset #${p.id}`,
        })),
      },
    ],
    [allPresets],
  );

  useEffect(() => {
    onSelectionChange({
      agentId: selectedAgentId,
      llmProviderId: effectiveLlm.provider_id,
      llmModel: effectiveLlm.model,
      modelPresetId: selectedPresetId,
    });
  }, [selectedAgentId, effectiveLlm.provider_id, effectiveLlm.model, selectedPresetId, onSelectionChange]);

  if (allAgents != null && allAgents.length === 0) {
    return (
      <div
        className={cn(
          "relative z-10 flex shrink-0 items-center gap-2 text-sm",
          embedded
            ? "rounded-md border border-border/70 bg-background/60 px-2 py-1.5"
            : "border-b border-border bg-muted/30 px-3 py-1.5",
        )}
      >
        <span className="text-muted-foreground">No agents configured.</span>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <Link to="/settings/agents">Configure agents</Link>
        </Button>
      </div>
    );
  }

  if (embedded) {
    return (
      <div className="relative z-10 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pr-1 scrollbar-thin">
        {showAgent ? (
          <label className={toolbarLabelEmbeddedClass}>
            <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
              <Bot className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
              <span className="sr-only">Agent</span>
            </span>
            <div className="min-w-[96px] max-w-[176px]">
              <ModelDropdown
                value={selectedAgentId}
                onChange={(id) => setAgentIdAndUrl(id)}
                groups={agentGroups}
                placeholder="Select agent"
                searchPlaceholder="Search agent"
                buttonClassName={embeddedDropdownButtonClass}
                footer={
                  <Link to="/settings/agents" className="text-primary underline-offset-4 hover:underline">
                    Configure agents ↗
                  </Link>
                }
              />
            </div>
          </label>
        ) : null}
        <span className="h-4 w-px shrink-0 bg-border/80" aria-hidden />
        <label className={toolbarLabelEmbeddedClass}>
          <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
            <span className="sr-only">Model</span>
          </span>
          <div className="min-w-[104px] max-w-[188px]">
            <ModelSelector
              value={effectiveLlm.model || ""}
              onChange={(m, providerId) => {
                setSelectedLlm({
                  provider_id: providerId
                    ? String(providerId)
                    : String(
                        effectiveLlm.provider_id ||
                          normalizedAgentDefault?.provider_id ||
                          firstAvailableLlm?.provider_id ||
                          "",
                      ).trim(),
                  model: m,
                });
              }}
              modelGroups={allLlms}
              placeholder="Select model"
              searchPlaceholder="Search model"
              buttonClassName={embeddedDropdownButtonClass}
            />
          </div>
        </label>
        <span className="h-4 w-px shrink-0 bg-border/80" aria-hidden />
        <label className={toolbarLabelEmbeddedClass}>
          <span className="inline-flex shrink-0 items-center justify-center text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
            <span className="sr-only">Preset</span>
          </span>
          <div className="min-w-[92px] max-w-[168px]">
            <ModelDropdown
              value={selectedPresetId != null ? String(selectedPresetId) : ""}
              onChange={(id) => setPresetIdAndUrl(id)}
              groups={presetGroups}
              placeholder="No preset"
              searchPlaceholder="Search preset"
              buttonClassName={embeddedDropdownButtonClass}
              footer={
                <Link to="/settings/model-presets" className="text-primary underline-offset-4 hover:underline">
                  Configure presets ↗
                </Link>
              }
            />
          </div>
        </label>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Stack above the message list so absolute ModelDropdown panels are not covered by
        // later siblings (scroll area paints after this row in DOM order).
        "relative z-10 grid shrink-0 gap-2",
        embedded
          ? "rounded-md border border-border/70 bg-background/60 px-2 py-1.5"
          : "border-b border-border bg-card/40 px-3 py-1.5 backdrop-blur-sm",
        embedded
          ? "grid-cols-1 md:grid-cols-[repeat(3,minmax(0,1fr))]"
          : "grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
        "items-end",
      )}
    >
      {showAgent ? (
        <label className={embedded ? toolbarLabelEmbeddedClass : toolbarLabelClass}>
          Agent
          <div className="min-w-0 flex-1">
            <ModelDropdown
              value={selectedAgentId}
              onChange={(id) => setAgentIdAndUrl(id)}
              groups={agentGroups}
              placeholder="Select agent"
              searchPlaceholder="Search agent"
              footer={
                <Link to="/settings/agents" className="text-primary underline-offset-4 hover:underline">
                  Configure agents ↗
                </Link>
              }
            />
          </div>
        </label>
      ) : null}
      <label className={cn(embedded ? toolbarLabelEmbeddedClass : toolbarLabelClass, "min-w-0")}>
        Model
        <div className="min-w-0 flex-1">
          <ModelSelector
            value={effectiveLlm.model || ""}
            onChange={(m, providerId) => {
              setSelectedLlm({
                provider_id: providerId
                  ? String(providerId)
                  : String(
                      effectiveLlm.provider_id ||
                        normalizedAgentDefault?.provider_id ||
                        firstAvailableLlm?.provider_id ||
                        "",
                    ).trim(),
                model: m,
              });
            }}
            modelGroups={allLlms}
            placeholder="Select model"
            searchPlaceholder="Search model"
          />
        </div>
      </label>
      <label className={embedded ? toolbarLabelEmbeddedClass : toolbarLabelClass}>
        Preset
        <div className="min-w-0 flex-1">
          <ModelDropdown
            value={selectedPresetId != null ? String(selectedPresetId) : ""}
            onChange={(id) => setPresetIdAndUrl(id)}
            groups={presetGroups}
            placeholder="No preset"
            searchPlaceholder="Search preset"
            footer={
              <Link to="/settings/model-presets" className="text-primary underline-offset-4 hover:underline">
                Configure presets ↗
              </Link>
            }
          />
        </div>
      </label>
    </div>
  );
}
