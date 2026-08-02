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

// ─── filesystem_read / filesystem_write (the split tools) ────────────────────

/**
 * A per-call quota bump the model may request when a cap truncated its last
 * result. Present + allowed → the call escalates to a user prompt; approved →
 * applyDefaults folds the requested value over the rule default for that one
 * call. There is no absolute ceiling — the human approval IS the ceiling.
 */
function readQuotaOverride(params: unknown): Record<string, number> {
  const raw = (params as { quota_override?: unknown } | null)?.quota_override;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) out[key] = Math.floor(value);
  }
  return out;
}

function quotaDetail(override: Record<string, number>): string {
  const asks = Object.entries(override).map(([k, v]) => `${k}→${v}`).join(', ');
  return `requests a higher limit for this call (${asks}) — approve to run once with it`;
}

/** Judge a `quota_override` on a call, shared by both split tools. Returns the
 *  evaluation when an override is present (ask, or forbid when disabled), or
 *  null when there is nothing to escalate. */
function evaluateQuota(params: unknown, allowOverride: boolean): RuleEvaluationResult[] | null {
  const override = readQuotaOverride(params);
  if (Object.keys(override).length === 0) return null;
  if (!allowOverride) {
    return [{ ruleName: 'filesystem-quota', permission: 'forbid', detail: 'quota overrides are disabled for this tool (allow_quota_override=false)' }];
  }
  return [{ ruleName: 'filesystem-quota', permission: 'ask_user', detail: quotaDetail(override) }];
}

/** Fold an approved override over the rule caps, keyed by the reserved param
 *  name, and drop `quota_override` from the dispatched params. */
function foldQuota(rest: Record<string, unknown>, override: Record<string, number>, caps: Record<string, number>): Record<string, unknown> {
  const folded: Record<string, number> = {};
  for (const [key, def] of Object.entries(caps)) folded[key] = override[key] ?? def;
  return { ...rest, ...folded };
}

const FilesystemReadRulesSchema = z
  .object({
    allowed_roots: z
      .array(z.string().min(1))
      .default([])
      .describe('Directory roots the tool may read/search. Empty (default) means the tool-host runtime\'s working directory.'),
    max_read_bytes: z.number().finite().int().min(256).max(50_000_000).default(200_000).describe('Cap on bytes returned by read.'),
    max_list_entries: z.number().finite().int().min(1).max(50_000).default(500).describe('Cap on entries returned by list.'),
    max_grep_results: z.number().finite().int().min(1).max(20_000).default(200).describe('Cap on hits returned by grep.'),
    max_find_results: z.number().finite().int().min(1).max(20_000).default(200).describe('Cap on paths returned by find.'),
    max_grep_file_bytes: z.number().finite().int().min(1024).max(200_000_000).default(2_000_000).describe('Skip files larger than this when scanning.'),
    timeout_ms: z.number().finite().int().min(50).max(600_000).default(2_000).describe('Wall-clock budget for a grep/find walk before it stops with a timeout note.'),
    allow_quota_override: z.boolean().default(true).describe('Let the model request a higher per-call limit (which prompts you for approval). Off refuses the request.'),
  })
  .strict();

type FilesystemReadRules = z.infer<typeof FilesystemReadRulesSchema>;

export const filesystemReadRulesProfile: HostToolRulesProfile = {
  rulesSchema: () => zerialize(FilesystemReadRulesSchema),
  defaultRules: () => FilesystemReadRulesSchema.parse({}),
  parseRules: (raw) => FilesystemReadRulesSchema.parse(raw ?? {}),
  evaluate(params, rawRules) {
    const rules = FilesystemReadRulesSchema.parse(rawRules ?? {});
    const quota = evaluateQuota(params, rules.allow_quota_override);
    if (quota) return quota;
    // Reads are non-mutating and contained to allowed_roots by the runtime, so
    // they run without a prompt (the point of splitting reads out).
    return [{ ruleName: 'filesystem-read', permission: 'allow', detail: 'read is contained to allowed roots by the runtime' }];
  },
  applyDefaults(params, rawRules) {
    const rules: FilesystemReadRules = FilesystemReadRulesSchema.parse(rawRules ?? {});
    const p = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
    const override = readQuotaOverride(p);
    const { quota_override: _drop, ...rest } = p;
    return foldQuota({ ...rest, allowed_roots: rules.allowed_roots }, override, {
      max_read_bytes: rules.max_read_bytes,
      max_list_entries: rules.max_list_entries,
      max_grep_results: rules.max_grep_results,
      max_find_results: rules.max_find_results,
      max_grep_file_bytes: rules.max_grep_file_bytes,
      timeout_ms: rules.timeout_ms,
    });
  },
};

const DELETE_OPERATIONS = new Set(['delete', 'move']);

const FilesystemWriteRulesSchema = z
  .object({
    writable_roots: z
      .array(z.string().min(1))
      .default([])
      .describe('Directory roots writes may touch. Empty (default) disables writes entirely — enabling the read tool never implies writes.'),
    max_write_bytes: z.number().finite().int().min(256).max(200_000_000).default(5_000_000).describe('Cap on the byte size of a written/edited file.'),
    allow_delete: z.boolean().default(false).describe('Permit the delete and move operations. Off (default) forbids removing or renaming files.'),
    timeout_ms: z.number().finite().int().min(50).max(600_000).default(2_000).describe('Wall-clock budget for a write operation.'),
    allow_quota_override: z.boolean().default(true).describe('Let the model request a higher per-call limit (which prompts you for approval). Off refuses the request.'),
  })
  .strict();

type FilesystemWriteRules = z.infer<typeof FilesystemWriteRulesSchema>;

export const filesystemWriteRulesProfile: HostToolRulesProfile = {
  rulesSchema: () => zerialize(FilesystemWriteRulesSchema),
  defaultRules: () => FilesystemWriteRulesSchema.parse({}),
  parseRules: (raw) => FilesystemWriteRulesSchema.parse(raw ?? {}),
  evaluate(params, rawRules) {
    const rules = FilesystemWriteRulesSchema.parse(rawRules ?? {});
    const operation = typeof (params as { operation?: unknown })?.operation === 'string' ? (params as { operation: string }).operation : '';
    if (rules.writable_roots.length === 0) {
      return [{ ruleName: 'filesystem-writes', permission: 'forbid', detail: 'writes are disabled — add a writable root to enable filesystem_write' }];
    }
    if (DELETE_OPERATIONS.has(operation) && !rules.allow_delete) {
      return [{ ruleName: 'filesystem-write-delete', permission: 'forbid', detail: `${operation} is disabled — enable allow_delete to permit delete/move` }];
    }
    const quota = evaluateQuota(params, rules.allow_quota_override);
    if (quota) return quota;
    return [{ ruleName: 'filesystem-write', permission: 'allow', detail: 'write path is contained to writable roots by the runtime' }];
  },
  applyDefaults(params, rawRules) {
    const rules: FilesystemWriteRules = FilesystemWriteRulesSchema.parse(rawRules ?? {});
    const p = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
    const override = readQuotaOverride(p);
    const { quota_override: _drop, ...rest } = p;
    return foldQuota({ ...rest, writable_roots: rules.writable_roots }, override, {
      max_write_bytes: rules.max_write_bytes,
      timeout_ms: rules.timeout_ms,
    });
  },
};

/** Rules profiles keyed by host tool name. */
export const HOST_TOOL_RULES_PROFILES: Record<string, HostToolRulesProfile> = {
  exec: execRulesProfile,
  filesystem: filesystemRulesProfile,
  filesystem_read: filesystemReadRulesProfile,
  filesystem_write: filesystemWriteRulesProfile,
};
