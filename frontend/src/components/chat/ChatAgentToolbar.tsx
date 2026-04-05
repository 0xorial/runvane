import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { getAgents, getLlmSettings, getModelPresets } from "../../api/client";
import { ModelDropdown } from "../ui/ModelDropdown";
import { ModelSelector } from "../ui/ModelSelector";
import { getAgentLlm } from "../../pages/settings/agentLlm";
import { buildModelGroups, sortAgents } from "../../pages/settings/helpers";
import type { ModelGroup } from "../../pages/settings/helpers";
import { cx } from "../../utils/cx";
import styles from "./ChatAgentToolbar.module.css";

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

type ChatAgentToolbarProps = {
  onSelectionChange: (selection: ChatAgentSelection) => void;
};

export function ChatAgentToolbar({
  onSelectionChange,
}: ChatAgentToolbarProps) {
  const [urlParams, setUrlParams] = useSearchParams();
  const [allAgents, setAllAgents] = useState<AgentListItemResponse[] | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [allLlms, setAllLlms] = useState<ModelGroup[]>([]);
  const [selectedLlm, setSelectedLlm] = useState<{
    provider_id: string;
    model: string;
  } | null>(null);
  const [allPresets, setAllPresets] = useState<ModelPresetResponse[] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(() =>
    presetIdFromSearchParams(urlParams),
  );

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
  const agentDefaultLlm = useMemo(
    () => getAgentLlm(currentAgent),
    [currentAgent],
  );
  useEffect(() => {
    setSelectedLlm(agentDefaultLlm);
  }, [selectedAgentId]);
  const effectiveLlm = selectedLlm ?? agentDefaultLlm;
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
  }, [
    selectedAgentId,
    effectiveLlm.provider_id,
    effectiveLlm.model,
    selectedPresetId,
    onSelectionChange,
  ]);

  if (allAgents != null && allAgents.length === 0) {
    return (
      <div className={styles.agentSetupBar}>
        <span>No agents configured.</span>
        <Link
          to="/settings/agents"
          className={cx("btn", styles.agentSetupBtn, styles.agentSetupLink)}
        >
          Configure agents
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.toolbar}>
      <label className={styles.toolbarLabel}>
        Agent
        <div className={styles.toolbarAgentDropdown}>
          <ModelDropdown
            value={selectedAgentId}
            onChange={(id) => setAgentIdAndUrl(id)}
            groups={agentGroups}
            placeholder="Select agent"
            searchPlaceholder="Search agent"
            footer={<Link to="/settings/agents">Configure agents ↗</Link>}
          />
        </div>
      </label>
      <label className={cx(styles.toolbarLabel, styles.toolbarLabelModel)}>
        Model
        <div className={styles.toolbarModelDropdown}>
          <ModelSelector
            value={effectiveLlm.model || ""}
            onChange={(m, providerId) => {
              setSelectedLlm({
                provider_id: providerId
                  ? String(providerId)
                  : String(
                      effectiveLlm.provider_id ||
                        agentDefaultLlm.provider_id ||
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
      <label className={styles.toolbarLabel}>
        Preset
        <div className={styles.toolbarPresetDropdown}>
          <ModelDropdown
            value={selectedPresetId != null ? String(selectedPresetId) : ""}
            onChange={(id) => setPresetIdAndUrl(id)}
            groups={presetGroups}
            placeholder="No preset"
            searchPlaceholder="Search preset"
            footer={<Link to="/settings/model-presets">Configure presets ↗</Link>}
          />
        </div>
      </label>
    </div>
  );
}
