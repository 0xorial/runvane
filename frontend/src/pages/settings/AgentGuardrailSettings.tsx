import { ModelSelector } from "../../components/ui/ModelSelector";
import type { ModelGroup } from "./helpers";
import { DEFAULT_GUARDRAIL_PROMPT } from "../../../../backend/src/contracts/guardrail";

export type GuardrailConfig = {
  provider_id: string;
  model_name: string;
  system_prompt: string;
};

type Props = {
  config: GuardrailConfig;
  onChange: (patch: Partial<GuardrailConfig>) => void;
  canEdit: boolean;
  modelGroups: ModelGroup[];
};

const fieldRow = "inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground";

const promptInput =
  "min-h-[90px] w-full resize-y rounded-[10px] border border-input bg-background px-2.5 py-2 text-[13px] leading-snug";

export function AgentGuardrailSettings({ config, onChange, canEdit, modelGroups }: Props) {
  return (
    <div className="mt-3.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[13px] font-bold text-foreground">Guardrail LLM</span>
      </div>
      <p className="mb-2.5 text-xs text-muted-foreground">
        When enabled per-tool, this LLM reviews each call before it runs. A flagged call pauses for your approval with the guardrail&apos;s reason shown.
      </p>

      <div className={fieldRow}>
        Model
        <div className="ml-1.5 min-w-[260px] flex-1">
          <ModelSelector
            value={config.model_name}
            disabled={!canEdit}
            onChange={(model, providerId) =>
              onChange({ model_name: model, provider_id: providerId ?? "" })
            }
            modelGroups={modelGroups}
            placeholder="Select guardrail model"
            searchPlaceholder="Search model"
          />
        </div>
      </div>

      <label className="mt-2 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        What to flag
        <textarea
          className={promptInput}
          value={config.system_prompt}
          disabled={!canEdit}
          onChange={(e) => onChange({ system_prompt: e.target.value })}
          placeholder={DEFAULT_GUARDRAIL_PROMPT}
          rows={4}
          spellCheck={false}
        />
      </label>
    </div>
  );
}

/** Read guardrail config out of raw agent llm_configuration. */
export function readGuardrailConfig(
  llmCfg: Record<string, unknown> | null | undefined,
): GuardrailConfig {
  const g = llmCfg?.guardrail;
  if (!g || typeof g !== "object" || Array.isArray(g)) {
    return { provider_id: "", model_name: "", system_prompt: "" };
  }
  const rec = g as Record<string, unknown>;
  return {
    provider_id: typeof rec.provider_id === "string" ? rec.provider_id : "",
    model_name: typeof rec.model_name === "string" ? rec.model_name : "",
    system_prompt: typeof rec.system_prompt === "string" ? rec.system_prompt : "",
  };
}
