import type { ChatEntry } from "../types/chatEntry.js";

export type ToolPermission = "allow" | "ask_user" | "forbid";
export type JsonSchema = Record<string, unknown>;

export type RuleEvaluationResult = {
  ruleName: string;
  permission: ToolPermission;
  detail: string;
};

export type ToolPermissionContext<TRules> = {
  conversationId: string;
  agentId: string | null;
  entries: ChatEntry[];
  agentToolConfig: {
    enabled: boolean;
    policy: ToolPermission;
    rules: TRules;
  };
};

export type ToolRunContext = {
  conversationId: string;
  agentId: string | null;
  entries: ChatEntry[];
  toolRules?: unknown;
};

export abstract class BaseTool<TParams = unknown, TRules = Record<string, unknown>> {
  abstract getName(): string;
  abstract getAiDescription(): string;
  abstract getHumanDescription(): string;
  abstract getParamsSchema(): JsonSchema;
  abstract getRulesSchema(): JsonSchema;
  abstract getDefaultRules(): TRules;
  abstract parseParams(raw: unknown): TParams;
  abstract parseRules(raw: unknown): TRules;

  /**
   * Evaluate ALL tool rules and return per-rule results.
   * Infra computes final permission from these results.
   */
  abstract evaluatePermission(
    context: ToolPermissionContext<TRules>,
  ): Promise<RuleEvaluationResult[]> | RuleEvaluationResult[];

  abstract runTool(
    params: TParams,
    context: ToolRunContext,
  ): Promise<unknown> | unknown;
}

const rank: Record<ToolPermission, number> = {
  forbid: 0,
  ask_user: 1,
  allow: 2,
};

export function mostPermissivePermission(
  rules: RuleEvaluationResult[],
): ToolPermission {
  if (rules.length === 0) return "forbid";
  let out: ToolPermission = "forbid";
  for (const row of rules) {
    if (rank[row.permission] > rank[out]) out = row.permission;
  }
  return out;
}
