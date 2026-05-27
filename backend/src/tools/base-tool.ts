import type { ChatEntry } from '../contracts/chatEntry.js';

export type ToolPermission = 'allow' | 'ask_user' | 'forbid';

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
  signal: AbortSignal;
};

export abstract class BaseTool<TParams = unknown, TRules = Record<string, unknown>> {
  abstract getName(): string;
  abstract getAiDescription(): string;
  abstract getHumanDescription(): string;
  /** JSON Schema for the LLM (params) — derived from the tool's Zod params schema. */
  abstract getParamsSchema(): unknown;
  /** The rules Zod schema, `zerialize`d for transport — the client `dezerialize`s it. */
  abstract getRulesSchema(): unknown;
  abstract getDefaultRules(): TRules;
  abstract parseParams(raw: unknown): TParams;
  abstract parseRules(raw: unknown): TRules;

  abstract evaluatePermission(
    context: ToolPermissionContext<TRules>,
  ): Promise<RuleEvaluationResult[]> | RuleEvaluationResult[];

  abstract runTool(params: TParams, context: ToolRunContext): Promise<unknown> | unknown;
}

const rank: Record<ToolPermission, number> = {
  forbid: 0,
  ask_user: 1,
  allow: 2,
};

export function mostPermissivePermission(rules: RuleEvaluationResult[]): ToolPermission {
  if (rules.length === 0) return 'forbid';
  let out: ToolPermission = 'forbid';
  for (const row of rules) {
    if (rank[row.permission] > rank[out]) out = row.permission;
  }
  return out;
}
