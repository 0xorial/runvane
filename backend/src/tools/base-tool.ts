import type { ChatEntry } from '../contracts/chatEntry.js';

export type ToolPermission = 'allow' | 'ask_user' | 'forbid';

/** Where a tool executes — `runtime` tools run in the sandbox/tool-host; `brain` tools run centrally. */
export type ToolLocation = 'brain' | 'runtime';

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
  /**
   * Emit incremental progress (stdout, streamed tokens, …) for the live tool
   * row while the tool runs. Ephemeral — not persisted; the final result is
   * still the saved output. Optional so non-streaming callers/tests can omit it.
   */
  onProgress?: (delta: string) => void;
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

  /**
   * Where this tool executes. `runtime` tools run in the sandbox/tool-host;
   * `brain` tools run centrally (the default). Surfaced to the UI and used to
   * route execution — override in subclasses that run in the sandbox.
   */
  getLocation(): ToolLocation {
    return 'brain';
  }
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
