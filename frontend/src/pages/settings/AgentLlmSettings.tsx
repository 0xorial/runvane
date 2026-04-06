import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { ModelDropdown } from "../../components/ui/ModelDropdown";
import { ModelSelector } from "../../components/ui/ModelSelector";
import { getAgentLlm, patchAgentLlm } from "./agentLlm";
import type { ModelGroup } from "./helpers";
import { cn } from "@/lib/utils";

type AgentLlmSettingsProps = {
  agent: AgentListItemResponse;
  onChange: (agent: AgentListItemResponse) => void;
  canEdit: boolean;
  modelGroups: ModelGroup[];
  presets: ModelPresetResponse[];
};

const fieldRow =
  "inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground";

export function AgentLlmSettings({
  agent,
  onChange,
  canEdit,
  modelGroups,
  presets,
}: AgentLlmSettingsProps) {
  const groups = Array.isArray(modelGroups) ? modelGroups : [];
  const { model } = getAgentLlm(agent);
  const presetGroups: ModelGroup[] = [
    {
      id: "presets",
      label: "",
      models: [
        { value: "", label: "No preset" },
        ...presets.map((p) => ({
          value: String(p.id),
          label: p.name.trim() || `Preset #${p.id}`,
        })),
      ],
    },
  ];

  return (
    <div className="relative z-[2] mb-5 overflow-visible">
      {groups.length === 0 ? (
        <p className="mb-3 text-[13px] text-amber-700 dark:text-amber-400">
          Verify at least one provider (fetch models) to pick a model here.
        </p>
      ) : null}
      <div className={fieldRow}>
        Default model
        <div className="ml-1.5 min-w-[260px] flex-1">
          <ModelSelector
            value={model}
            disabled={!canEdit}
            onChange={(m, providerId) => {
              if (!canEdit) return;
              onChange(
                patchAgentLlm(agent, {
                  provider_id: providerId ?? undefined,
                  model: m,
                }),
              );
            }}
            modelGroups={groups}
            placeholder="Select model"
            searchPlaceholder="Search model"
          />
        </div>
      </div>
      <div className={cn(fieldRow, "mt-2")}>
        Default preset
        <div className="ml-1.5 min-w-[260px] flex-1">
          <ModelDropdown
            value={
              agent.default_model_preset_id == null
                ? ""
                : String(agent.default_model_preset_id)
            }
            disabled={!canEdit}
            onChange={(value) => {
              if (!canEdit) return;
              const t = String(value || "").trim();
              onChange({
                ...agent,
                default_model_preset_id: /^\d+$/.test(t) ? Number(t) : null,
              });
            }}
            groups={presetGroups}
            placeholder="No preset"
            searchPlaceholder="Search preset"
          />
        </div>
      </div>
    </div>
  );
}
