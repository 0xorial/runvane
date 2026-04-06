import type { Dispatch, SetStateAction } from "react";
import { ModelSelector } from "../../components/ui/ModelSelector";
import type { LlmSettings } from "../../types/llmSettings";
import type { ModelGroup } from "./helpers";
import { cn } from "@/lib/utils";

type GlobalModelSettingsCardProps = {
  settings: LlmSettings;
  setSettings: Dispatch<SetStateAction<LlmSettings | null>>;
  modelGroups: ModelGroup[];
};

const labelRow = "inline-flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground";

export function GlobalModelSettingsCard({
  settings,
  setSettings,
  modelGroups,
}: GlobalModelSettingsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="mb-2.5 text-[15px] font-extrabold">Global settings</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-muted-foreground">
          <span className={labelRow}>
            System reasoning model
            <span
              className={cn(
                "inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[11px] leading-none text-muted-foreground",
              )}
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

        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-muted-foreground">
          <span className={labelRow}>
            Embedding model
            <span
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[11px] leading-none text-muted-foreground"
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
