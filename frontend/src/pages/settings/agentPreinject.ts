import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import {
  PREINJECT_FILE_TYPES,
  SCANNED_PREINJECT_TYPES,
  type AgentPreinjectConfig,
  type PreinjectFileType,
  type PreinjectMode,
  type PreinjectPreviewFile,
} from "@/protocol/chatEntry";

export { PREINJECT_FILE_TYPES, SCANNED_PREINJECT_TYPES };
export type { PreinjectFileType, PreinjectMode };

const MODES: readonly PreinjectMode[] = ["all", "none", "selected"];

export const PREINJECT_MODE_LABELS: Record<PreinjectMode, string> = {
  all: "All",
  none: "None",
  selected: "Selected types",
};

// manifest / lint_config / env_example are legacy labels: no new scan emits
// them (discovery is instruction-files + root README now), but persisted
// entries from the flat root-grab era still render with them.
export const PREINJECT_FILE_TYPE_LABELS: Record<PreinjectFileType, string> = {
  instructions: "AI instructions (CLAUDE.md, AGENTS.md, .cursorrules, …)",
  manifest: "Package manifest (package.json, pyproject.toml, …)",
  readme: "README (workspace root)",
  lint_config: "Lint / format config",
  env_example: "Env var sample (.env.example)",
};

function toMode(value: unknown): PreinjectMode {
  return MODES.includes(value as PreinjectMode) ? (value as PreinjectMode) : "none";
}

function toTypes(value: unknown): PreinjectFileType[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is PreinjectFileType => PREINJECT_FILE_TYPES.includes(v));
}

export function readPreinjectConfig(
  llmCfg: Record<string, unknown> | null | undefined,
): AgentPreinjectConfig {
  const raw = llmCfg?.preinject;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { mode: "none" };
  const rec = raw as Record<string, unknown>;
  return { mode: toMode(rec.mode), types: toTypes(rec.types) };
}

/**
 * The candidate paths the agent's preinject config would inject — the default
 * checkbox state of the first-message staging selection (Start context section
 * and the composer estimate derive it identically; the send compiles an
 * explicit override only once the user touches a checkbox, so untouched
 * behavior stays config-driven end to end).
 */
export function seedPathsFromConfig(files: PreinjectPreviewFile[], config: AgentPreinjectConfig): string[] {
  if (config.mode === "none") return [];
  const types = config.mode === "selected" ? new Set(config.types ?? []) : null;
  return files
    .filter((f) => f.status === "injected" && (!types || types.has(f.fileType)))
    .map((f) => f.path);
}

export function patchPreinjectOnAgent(
  agent: AgentListItemResponse,
  patch: Partial<AgentPreinjectConfig>,
): AgentListItemResponse {
  const currentCfg = (agent.default_llm_configuration ?? {}) as Record<string, unknown>;
  const current = readPreinjectConfig(currentCfg);
  const next: AgentPreinjectConfig = { ...current, ...patch };
  return {
    ...agent,
    default_llm_configuration: { ...currentCfg, preinject: next },
  };
}
