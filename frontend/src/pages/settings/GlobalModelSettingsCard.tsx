import type { Dispatch, SetStateAction } from "react";
import { ModelSelector } from "../../components/ui/ModelSelector";
import type { LlmSettings } from "../../types/llmSettings";
import type { ModelGroup } from "./helpers";
import styles from "./GlobalModelSettingsCard.module.css";

type GlobalModelSettingsCardProps = {
  settings: LlmSettings;
  setSettings: Dispatch<SetStateAction<LlmSettings | null>>;
  modelGroups: ModelGroup[];
};

export function GlobalModelSettingsCard({
  settings,
  setSettings,
  modelGroups,
}: GlobalModelSettingsCardProps) {
  return (
    <div className={styles.settingsGlobalModelsCard}>
      <div className={styles.settingsGlobalModelsTitle}>Global settings</div>
      <div className={styles.settingsGlobalModelsGrid}>
        <label>
          <span className={styles.settingsLabelWithTip}>
            System reasoning model
            <span
              className={styles.settingsInfoTip}
              title="Primary model used for general reasoning and response generation."
            >
              ⓘ
            </span>
          </span>
          <ModelSelector
            value={settings.llm_configuration?.model_name || ""}
            onChange={(nextValue) => {
              setSettings((prev) => {
                if (!prev) return prev;
                const next = structuredClone(prev);
                next.llm_configuration.model_name = nextValue;
                return next;
              });
            }}
            modelGroups={modelGroups}
            placeholder="Select model"
            searchPlaceholder="Search model"
          />
        </label>

        <label>
          <span className={styles.settingsLabelWithTip}>
            Embedding model
            <span
              className={styles.settingsInfoTip}
              title="Model used for embedding vectors (memory/retrieval)."
            >
              ⓘ
            </span>
          </span>
          <ModelSelector
            value={String(settings.llm_configuration?.model_settings?.embedding_model || "")}
            onChange={(nextValue) => {
              setSettings((prev) => {
                if (!prev) return prev;
                const next = structuredClone(prev);
                next.llm_configuration.model_settings = {
                  ...next.llm_configuration.model_settings,
                  embedding_model: nextValue,
                };
                return next;
              });
            }}
            modelGroups={modelGroups}
            placeholder="Select model"
            searchPlaceholder="Search model"
          />
        </label>
      </div>
    </div>
  );
}
