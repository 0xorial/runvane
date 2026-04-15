/** Merge agent JSON tools[] + policy.policies with catalog-driven UI. */

export type MutableAgent = {
  id?: string;
  name?: string;
  llms?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  policy?: {
    policies: Record<string, Record<string, unknown>>;
    default: Record<string, unknown>;
  };
  [key: string]: unknown;
};

function ensurePolicyShape(agent: MutableAgent): void {
  if (!agent.policy || typeof agent.policy !== "object") {
    agent.policy = {
      policies: {},
      default: { mode: "deny", require_approval: true },
    };
  }
  if (!agent.policy.policies || typeof agent.policy.policies !== "object") {
    agent.policy.policies = {};
  }
  if (!agent.policy.default || typeof agent.policy.default !== "object") {
    agent.policy.default = { mode: "deny", require_approval: true };
  }
}

function getPolicyCfg(agent: MutableAgent, toolName: string): Record<string, unknown> {
  ensurePolicyShape(agent);
  const pol = agent.policy!.policies[toolName];
  if (pol && typeof pol === "object") return pol;
  return agent.policy!.default;
}

export function getToolPermissionMode(agent: MutableAgent, toolName: string): "ask_every_time" | "allow_all" {
  const cfg = getPolicyCfg(agent, toolName);
  const mode = (cfg.mode as string) || "deny";
  if (mode === "deny") return "ask_every_time";
  return cfg.require_approval ? "ask_every_time" : "allow_all";
}

export function isToolEnabled(agent: MutableAgent, toolName: string): boolean {
  const tools = Array.isArray(agent.tools) ? agent.tools : [];
  const row = tools.find((t) => t && String((t as { tool_name?: string }).tool_name) === toolName);
  if (!row) return false;
  return (row as { enabled?: boolean }).enabled !== false;
}

export function setToolEnabled(agent: MutableAgent, toolName: string, enabled: boolean): void {
  if (!Array.isArray(agent.tools)) agent.tools = [];
  let row = agent.tools.find((t) => t && String((t as { tool_name?: string }).tool_name) === toolName);
  if (!row) {
    row = { tool_name: toolName, enabled: true, overrides: {} };
    agent.tools.push(row);
  }
  (row as { enabled: boolean }).enabled = !!enabled;
}

/** Apply enabled flag to every name in toolNames (creates rows as needed). */
export function setAllToolsEnabled(agent: MutableAgent, toolNames: string[], enabled: boolean): void {
  const on = !!enabled;
  for (const toolName of toolNames) {
    if (!toolName) continue;
    setToolEnabled(agent, toolName, on);
  }
}

export function setToolPermissionMode(agent: MutableAgent, toolName: string, mode: string): void {
  ensurePolicyShape(agent);
  const prev = agent.policy!.policies[toolName];
  const base = prev && typeof prev === "object" ? { ...prev } : ({} as Record<string, unknown>);
  base.mode = "allow";
  base.require_approval = mode === "ask_every_time";
  agent.policy!.policies[toolName] = base;
}

export function tryParseAgentJson(text: string): MutableAgent | null {
  try {
    return JSON.parse(text) as MutableAgent;
  } catch {
    return null;
  }
}
