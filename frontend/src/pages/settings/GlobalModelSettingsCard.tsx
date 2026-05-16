import type { Dispatch, SetStateAction } from "react";
import { ModelSelector } from "../../components/ui/ModelSelector";
import type { LlmSettings } from "../../types/llmSettings";
import type { ModelGroup } from "./helpers";

type GlobalModelSettingsCardProps = {
  settings: LlmSettings;
  setSettings: Dispatch<SetStateAction<LlmSettings | null>>;
  modelGroups: ModelGroup[];
};

type FieldProps = {
  label: string;
  description: string;
  children: React.ReactNode;
};

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[13px] font-semibold text-foreground">{label}</div>
      <div className="mb-1 text-[12px] leading-snug text-muted-foreground">{description}</div>
      {children}
    </div>
  );
}

export function GlobalModelSettingsCard({ settings, setSettings, modelGroups }: GlobalModelSettingsCardProps) {
  const titleModelSet = !!settings.llm_configuration?.title_model_name;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[14px] font-bold">Global model settings</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          Defaults used when an agent doesn't specify its own model.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-3">
        <div className="bg-card p-4">
          <Field
            label="Reasoning model"
            description="Used for agent responses and planning."
          >
            <ModelSelector
              value={settings.llm_configuration?.model_name || ""}
              onChange={(nextValue, providerId) => {
                setSettings((prev) => {
                  if (!prev) return prev;
                  const next = structuredClone(prev);
                  next.llm_configuration.model_name = nextValue;
                  if (providerId && String(providerId).trim()) {
                    next.llm_configuration.provider_id = String(providerId).trim();
                  }
                  return next;
                });
              }}
              modelGroups={modelGroups}
              placeholder="Select model"
              searchPlaceholder="Search model"
            />
          </Field>
        </div>

        <div className="bg-card p-4">
          <Field
            label="Title model"
            description="Auto-generates conversation titles."
          >
            <ModelSelector
              value={String(settings.llm_configuration?.title_model_name || "")}
              onChange={(nextValue, providerId) => {
                setSettings((prev) => {
                  if (!prev) return prev;
                  const next = structuredClone(prev);
                  next.llm_configuration.title_model_name = nextValue || undefined;
                  next.llm_configuration.title_provider_id = nextValue
                    ? (providerId ? String(providerId).trim() : next.llm_configuration.title_provider_id)
                    : undefined;
                  return next;
                });
              }}
              modelGroups={modelGroups}
              placeholder="Same as agent model"
              searchPlaceholder="Search model"
            />
            {titleModelSet && (
              <button
                type="button"
                className="mt-1.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  setSettings((prev) => {
                    if (!prev) return prev;
                    const next = structuredClone(prev);
                    next.llm_configuration.title_model_name = undefined;
                    next.llm_configuration.title_provider_id = undefined;
                    return next;
                  })
                }
              >
                Reset to agent model
              </button>
            )}
          </Field>
        </div>

        <div className="bg-card p-4">
          <Field
            label="Embedding model"
            description="Used for memory and retrieval (future)."
          >
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
          </Field>
        </div>
      </div>
    </div>
  );
}
