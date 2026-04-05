import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";
import type { ModelPresetResponse } from "../../../../backend/src/routes/modelPresets.types";
import { ModelDropdown } from "../../components/ui/ModelDropdown";
import { ModelSelector } from "../../components/ui/ModelSelector";
import { getAgentLlm, patchAgentLlm } from "./agentLlm";
import type { ModelGroup } from "./helpers";
import styles from "./AgentLlmSettings.module.css";

type AgentLlmSettingsProps = {
  agent: AgentListItemResponse;
  onChange: (agent: AgentListItemResponse) => void;
  canEdit: boolean;
  modelGroups: ModelGroup[];
  presets: ModelPresetResponse[];
};

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
    <div className={styles.agentLlmSettings}>
      {groups.length === 0 ? (
        <p className={styles.agentLlmSettingsWarn}>
          Verify at least one provider (fetch models) to pick a model here.
        </p>
      ) : null}
      <div className={styles.agentsNameField}>
        Default model
        <div className={styles.agentLlmModelCell}>
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
      <div className={styles.agentsNameField}>
        Default preset
        <div className={styles.agentLlmModelCell}>
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
