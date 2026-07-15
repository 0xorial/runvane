import { z } from 'zod';
import { zerialize } from 'zodex';
import type { RuleEvaluationResult } from '../tools/base-tool.js';

/**
 * A rules profile a {@link HostToolProxy} can wear so a specific host tool
 * becomes safety-bearing (real rules + per-call permission logic) instead of
 * the empty default. Attached by name in ToolHostService — the tool keeps
 * running in the sandbox via the tool-host, but gains governance.
 */
export interface HostToolRulesProfile {
  rulesSchema(): unknown;
  defaultRules(): Record<string, unknown>;
  parseRules(raw: unknown): Record<string, unknown>;
  /** Judge a single call from its params + rules (custom policy only). */
  evaluate(params: unknown, rules: Record<string, unknown>): RuleEvaluationResult[];
  /** Fill defaults into params before dispatch (e.g. a working directory). */
  applyDefaults(params: unknown, rules: Record<string, unknown>): unknown;
}

// ─── exec ────────────────────────────────────────────────────────────────────

const ExecRulesSchema = z
  .object({
    allowed_prefixes: z
      .array(z.string().min(1))
      .default([
        'ls',
        'pwd',
        'cat',
        'head',
        'tail',
        'grep',
        'rg',
        'git status',
        'git diff',
        'git log',
        'git show',
        'git branch',
        'wc',
        'stat',
        'file',
        'echo',
        'whoami',
        'date',
        'node --version',
        'npm --version',
      ])
      .describe(
        'Command prefixes that run without prompting (matched on a word boundary). ' +
          'A command containing shell operators (; && || | ` $( > < &) never auto-runs via a prefix.',
      ),
    ask_outside_allowlist: z
      .boolean()
      .default(true)
      .describe('Prompt for approval when a command does not match an allowed prefix. Set false to run anything.'),
    default_cwd: z
      .string()
      .default('')
      .describe('Working directory injected when the command omits one. Empty leaves the sandbox default.'),
  })
  .strict();

type ExecRules = z.infer<typeof ExecRulesSchema>;

// Shell metacharacters that let a command do more than its leading token
// suggests — a prefix allowlist can't reason past them, so they force a prompt.
const SHELL_OPERATORS = /[;&|`\n]|\$\(|>|</;

/** True when the trimmed command starts with `prefix` on a word boundary. */
export function commandMatchesPrefix(command: string, prefix: string): boolean {
  const c = command.trim();
  const p = prefix.trim();
  if (!p) return false;
  if (c === p) return true;
  if (!c.startsWith(p)) return false;
  // The char after the prefix must be whitespace, so `git log` doesn't match
  // `git logfoo` (but does match `git log --oneline`).
  return /\s/.test(c.charAt(p.length));
}

export function execCommandAllowed(command: string, rules: ExecRules): boolean {
  if (SHELL_OPERATORS.test(command)) return false;
  return rules.allowed_prefixes.some((prefix) => commandMatchesPrefix(command, prefix));
}

export const execRulesProfile: HostToolRulesProfile = {
  rulesSchema: () => zerialize(ExecRulesSchema),
  defaultRules: () => ExecRulesSchema.parse({}),
  parseRules: (raw) => ExecRulesSchema.parse(raw ?? {}),
  evaluate(params, rawRules) {
    const rules = ExecRulesSchema.parse(rawRules ?? {});
    const command = typeof (params as { command?: unknown })?.command === 'string' ? (params as { command: string }).command : '';
    if (execCommandAllowed(command, rules)) {
      return [{ ruleName: 'exec-allowlist', permission: 'allow', detail: 'command matches an allowed prefix' }];
    }
    if (rules.ask_outside_allowlist) {
      return [{ ruleName: 'exec-allowlist', permission: 'ask_user', detail: 'command is outside the allowlist' }];
    }
    return [{ ruleName: 'exec-allowlist', permission: 'allow', detail: 'allowlist not enforced (ask_outside_allowlist=false)' }];
  },
  applyDefaults(params, rawRules) {
    const rules = ExecRulesSchema.parse(rawRules ?? {});
    if (!rules.default_cwd) return params;
    if (!params || typeof params !== 'object') return params;
    const p = params as Record<string, unknown>;
    if (typeof p.cwd === 'string' && p.cwd.trim()) return params;
    return { ...p, cwd: rules.default_cwd };
  },
};

/** Rules profiles keyed by host tool name. */
export const HOST_TOOL_RULES_PROFILES: Record<string, HostToolRulesProfile> = {
  exec: execRulesProfile,
};
