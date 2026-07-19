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

// ─── filesystem ──────────────────────────────────────────────────────────────

const FilesystemRulesSchema = z
  .object({
    allowed_roots: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Directory roots the tool may READ from, as paths in the sandbox. ' +
          'Empty (the default) means the tool-host runtime\'s working directory.',
      ),
    writable_roots: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Directory roots write_file/edit_file may write to. Empty (the default) means writes are disabled — ' +
          'enabling the tool for reads never implicitly grants writes.',
      ),
    max_read_bytes: z
      .number()
      .finite()
      .int()
      .min(256)
      .max(5_000_000)
      .default(200_000)
      .describe('Hard cap on bytes returned by read_file.'),
    max_list_entries: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(5000)
      .default(500)
      .describe('Hard cap on entries returned by list_dir.'),
    max_grep_results: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(2000)
      .default(200)
      .describe('Hard cap on hits returned by grep.'),
    max_grep_file_bytes: z
      .number()
      .finite()
      .int()
      .min(1024)
      .max(20_000_000)
      .default(2_000_000)
      .describe('Skip files larger than this when scanning with grep.'),
  })
  .strict();

type FilesystemRules = z.infer<typeof FilesystemRulesSchema>;

const WRITE_OPERATIONS = new Set(['write_file', 'edit_file']);

/**
 * Governance for THE filesystem tool (which runs in the tool-host, wherever
 * the conversation's sandbox lives). The permission decision happens here;
 * containment happens in the runtime: applyDefaults injects the roots/caps as
 * reserved params, and the runtime enforces them with realpath checks on the
 * machine that actually holds the files. Injection overrides anything the
 * model put in those keys.
 */
export const filesystemRulesProfile: HostToolRulesProfile = {
  rulesSchema: () => zerialize(FilesystemRulesSchema),
  defaultRules: () => FilesystemRulesSchema.parse({}),
  parseRules: (raw) => FilesystemRulesSchema.parse(raw ?? {}),
  evaluate(params, rawRules) {
    const rules = FilesystemRulesSchema.parse(rawRules ?? {});
    const operation = typeof (params as { operation?: unknown })?.operation === 'string'
      ? (params as { operation: string }).operation
      : '';
    if (WRITE_OPERATIONS.has(operation)) {
      if (rules.writable_roots.length === 0) {
        return [
          {
            ruleName: 'filesystem-writes',
            permission: 'forbid',
            detail: 'writes are disabled — add a writable root to enable write_file/edit_file',
          },
        ];
      }
      return [
        { ruleName: 'filesystem-writes', permission: 'allow', detail: 'write path is contained to writable roots by the runtime' },
      ];
    }
    return [
      { ruleName: 'filesystem-reads', permission: 'allow', detail: 'read path is contained to allowed roots by the runtime' },
    ];
  },
  applyDefaults(params, rawRules) {
    const rules: FilesystemRules = FilesystemRulesSchema.parse(rawRules ?? {});
    const p = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
    return {
      ...p,
      allowed_roots: rules.allowed_roots,
      writable_roots: rules.writable_roots,
      max_read_bytes: rules.max_read_bytes,
      max_list_entries: rules.max_list_entries,
      max_grep_results: rules.max_grep_results,
      max_grep_file_bytes: rules.max_grep_file_bytes,
    };
  },
};

/** Rules profiles keyed by host tool name. */
export const HOST_TOOL_RULES_PROFILES: Record<string, HostToolRulesProfile> = {
  exec: execRulesProfile,
  filesystem: filesystemRulesProfile,
};
