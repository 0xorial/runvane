import type { ChatEntry } from '../contracts/chatEntry.js';

export type ToolPermission = 'allow' | 'ask_user' | 'forbid';

/**
 * Per-agent×tool permission policy, set on the agent↔tool link and resolved
 * centrally in RunToolService:
 * - `off`    — tool is unavailable to the agent (not advertised; denied if called)
 * - `ask`    — prompt the user for approval before each call
 * - `allow`  — run without prompting
 * - `custom` — defer to the tool's own {@link BaseTool.evaluatePermission}
 */
export type ToolPolicy = 'off' | 'ask' | 'allow' | 'custom';

/** Where a tool executes — `target` tools run in the target sandbox/tool-host; `harness` tools run centrally. */
export type ToolLocation = 'harness' | 'target';

export type RuleEvaluationResult = {
  ruleName: string;
  permission: ToolPermission;
  detail: string;
};

export type ToolPermissionContext<TRules> = {
  conversationId: string;
  agentId: string | null;
  entries: ChatEntry[];
  rules: TRules;
  /** The parsed params of the specific call being judged (e.g. a command
   *  string), so per-call permission logic can inspect the actual arguments. */
  params: unknown;
};

export type ToolRunContext = {
  conversationId: string;
  agentId: string | null;
  entries: ChatEntry[];
  toolRules?: unknown;
  signal: AbortSignal;
  /**
   * Emit incremental progress (stdout, streamed tokens, …) for the live tool
   * row while the tool runs. Streams live and is persisted as the run's log.
   * Optional so non-streaming callers/tests can omit it.
   */
  onProgress?: (delta: string) => void;
  /**
   * Timestamped tool activity line — `[11:10:10] connecting to …`. Rides the
   * progress stream, so it shows live on the tool row and persists into the
   * run's log. Prefer this over onProgress for step-by-step narration.
   */
  log?: (message: string) => void;
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

  /**
   * The policy applied when an agent first enables this tool. Defaults to the
   * safe `ask`; override (→ `allow`) for read-only tools that never need a
   * prompt.
   */
  getDefaultPolicy(): ToolPolicy {
    return 'ask';
  }

  /**
   * Dynamic, per-call permission logic. Only consulted when the agent sets this
   * tool's policy to `custom` — `off`/`ask`/`allow` are resolved centrally in
   * RunToolService without calling this. The default allows; override only for
   * tools that need content- or context-dependent decisions.
   */
  evaluatePermission(
    _context: ToolPermissionContext<TRules>,
  ): Promise<RuleEvaluationResult[]> | RuleEvaluationResult[] {
    return [{ ruleName: 'default', permission: 'allow', detail: 'No custom permission logic.' }];
  }

  abstract runTool(params: TParams, context: ToolRunContext): Promise<unknown> | unknown;

  /**
   * Where this tool executes. `target` tools run in the target sandbox/tool-host;
   * `harness` tools run centrally (the default). Surfaced to the UI and used to
   * route execution — override in subclasses that run in the target sandbox.
   */
  getLocation(): ToolLocation {
    return 'harness';
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
