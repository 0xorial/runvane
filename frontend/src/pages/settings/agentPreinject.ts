import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import { PREINJECT_FILE_TYPES, type AgentPreinjectConfig, type PreinjectFileType, type PreinjectMode } from "@/protocol/chatEntry";

export { PREINJECT_FILE_TYPES };
export type { PreinjectFileType, PreinjectMode };

const MODES: readonly PreinjectMode[] = ["all", "none", "selected"];

export const PREINJECT_MODE_LABELS: Record<PreinjectMode, string> = {
  all: "All",
  none: "None",
  selected: "Selected types",
};

export const PREINJECT_FILE_TYPE_LABELS: Record<PreinjectFileType, string> = {
  instructions: "Agent instructions (CLAUDE.md, AGENTS.md, .cursorrules, …)",
  manifest: "Package manifest (package.json, pyproject.toml, …)",
  readme: "README",
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
