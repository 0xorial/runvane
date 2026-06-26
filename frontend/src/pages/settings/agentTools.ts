import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import { readGuardrailConfig, type GuardrailConfig } from "./agentGuardrail";

export type ToolPolicy = "off" | "ask" | "allow" | "custom";

export type ToolConfig = {
  policy: ToolPolicy;
  guardrail: boolean;
  guardrail_system_prompt: string;
  config: Record<string, unknown>;
};

export const TOOL_POLICIES: ReadonlyArray<{ value: ToolPolicy; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Tool unavailable to this agent" },
  { value: "ask", label: "Ask", hint: "Prompt for approval before each call" },
  { value: "allow", label: "Allow", hint: "Run without prompting" },
  { value: "custom", label: "Custom", hint: "Defer to the tool's own permission logic" },
];

export function toToolPolicy(value: unknown): ToolPolicy {
  return value === "ask" || value === "allow" || value === "custom" ? value : "off";
}

export function getToolConfigFromAgent(
  agent: AgentListItemResponse | null | undefined,
  toolName: string,
): ToolConfig {
  const cfg =
    agent?.default_llm_configuration &&
    typeof agent.default_llm_configuration === "object" &&
    !Array.isArray(agent.default_llm_configuration)
      ? (agent.default_llm_configuration as Record<string, unknown>)
      : {};
  const tools =
    cfg.tools && typeof cfg.tools === "object" && !Array.isArray(cfg.tools)
      ? (cfg.tools as Record<string, unknown>)
      : {};
  const raw = tools[toolName];
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const config =
    rec.rules && typeof rec.rules === "object" && !Array.isArray(rec.rules)
      ? (rec.rules as Record<string, unknown>)
      : {};
  return {
    policy: toToolPolicy(rec.policy),
    guardrail: rec.guardrail === true,
    guardrail_system_prompt: typeof rec.guardrail_system_prompt === "string" ? rec.guardrail_system_prompt : "",
    config,
  };
}

export function patchToolConfigOnAgent(
  agent: AgentListItemResponse,
  toolName: string,
  patch: {
    policy?: ToolPolicy;
    guardrail?: boolean;
    guardrail_system_prompt?: string;
    config?: Record<string, unknown>;
  },
): AgentListItemResponse {
  const currentCfg =
    agent.default_llm_configuration &&
    typeof agent.default_llm_configuration === "object" &&
    !Array.isArray(agent.default_llm_configuration)
      ? (agent.default_llm_configuration as Record<string, unknown>)
      : {};
  const nextCfg: Record<string, unknown> = { ...currentCfg };
  const tools =
    nextCfg.tools && typeof nextCfg.tools === "object" && !Array.isArray(nextCfg.tools)
      ? { ...(nextCfg.tools as Record<string, unknown>) }
      : {};
  const currentTool = tools[toolName];
  const toolRec =
    currentTool && typeof currentTool === "object" && !Array.isArray(currentTool)
      ? { ...(currentTool as Record<string, unknown>) }
      : {};
  if (patch.policy !== undefined) toolRec.policy = patch.policy;
  if (patch.guardrail !== undefined) toolRec.guardrail = patch.guardrail;
  // Drop the legacy enabled flag if a stored config still carries it.
  delete toolRec.enabled;
  if (patch.guardrail_system_prompt !== undefined) {
    if (patch.guardrail_system_prompt === "") delete toolRec.guardrail_system_prompt;
    else toolRec.guardrail_system_prompt = patch.guardrail_system_prompt;
  }
  if (patch.config !== undefined) toolRec.rules = patch.config;
  tools[toolName] = toolRec;
  nextCfg.tools = tools;
  return { ...agent, default_llm_configuration: nextCfg };
}

export function patchGuardrailOnAgent(
  agent: AgentListItemResponse,
  patch: Partial<GuardrailConfig>,
): AgentListItemResponse {
  const currentCfg = (agent.default_llm_configuration ?? {}) as Record<string, unknown>;
  const currentGuardrail = readGuardrailConfig(currentCfg);
  return {
    ...agent,
    default_llm_configuration: {
      ...currentCfg,
      guardrail: { ...currentGuardrail, ...patch },
    },
  };
}

export function getToolDefaultConfig(
  toolCatalog: Record<string, unknown>[],
  toolName: string,
): Record<string, unknown> {
  const tool = toolCatalog.find((raw) => String(raw.name ?? "") === toolName);
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return {};
  const rec = tool as Record<string, unknown>;
  const defaultRulesRaw = rec.default_rules;
  if (defaultRulesRaw && typeof defaultRulesRaw === "object" && !Array.isArray(defaultRulesRaw)) {
    return { ...(defaultRulesRaw as Record<string, unknown>) };
  }
  const rulesSchema =
    rec.rules_schema && typeof rec.rules_schema === "object" && !Array.isArray(rec.rules_schema)
      ? (rec.rules_schema as Record<string, unknown>)
      : {};
  const properties =
    rulesSchema.properties && typeof rulesSchema.properties === "object" && !Array.isArray(rulesSchema.properties)
      ? (rulesSchema.properties as Record<string, unknown>)
      : {};
  const defaults: Record<string, unknown> = {};
  for (const [key, rawProp] of Object.entries(properties)) {
    if (!rawProp || typeof rawProp !== "object" || Array.isArray(rawProp)) continue;
    const prop = rawProp as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(prop, "default")) {
      defaults[key] = prop.default;
      continue;
    }
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      defaults[key] = prop.enum[0];
      continue;
    }
    const type = typeof prop.type === "string" ? prop.type : "";
    if (type === "boolean") defaults[key] = false;
    else if (type === "number" || type === "integer") defaults[key] = 0;
    else if (type === "string") defaults[key] = "";
    else if (type === "array") defaults[key] = [];
    else if (type === "object") defaults[key] = {};
  }
  return defaults;
}
