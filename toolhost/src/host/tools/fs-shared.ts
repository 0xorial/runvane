import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Shared helpers for the split filesystem tools (`filesystem_read`,
 * `filesystem_write`). The realpath containment (`resolveAllowedPath`,
 * `resolveWritablePath`) and diff rendering are imported from `fs.ts` — the
 * original tool is left untouched, but its security-critical path logic is
 * reused rather than duplicated (duplicated containment drifts and leaks).
 *
 * The new pieces live here: one `fileHash` shared by BOTH tools (so the token
 * read hands out is exactly what write checks against), the pure line-range
 * edit math, per-tool governance parsing, and a wall-clock deadline for the
 * grep/find walks.
 */

// Cap on any single returned line, so a minified one-line file can't blow the
// token budget through grep or a ranged read.
export const MAX_LINE_LENGTH = 1000;

export function capLine(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

/**
 * Optimistic-lock token carried across `filesystem_read` → `filesystem_write`.
 * 64 bits of sha256 is ample to detect a file that changed under a parallel
 * edit; kept short to stay cheap in tool results. This is the ONE hash both
 * tools call — read computes it, write recomputes and compares.
 */
export function fileHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** Cheap binary sniff: a NUL byte means "don't decode as UTF-8". */
export function isBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/**
 * Replace `length` lines starting at 1-based `offset` with `content`, as pure
 * string math (no I/O — unit-testable in isolation). This is the whole of
 * `edit`:
 *   - length 0            → pure insert before `offset`
 *   - content ''          → delete the `length` lines
 *   - both                → change/range-replace
 * `offset` past EOF appends; `length` past EOF clamps to the remaining lines.
 */
export function applyRangeEdit(before: string, offset: number, length: number, content: string): string {
  const lines = before.split('\n');
  const start = Math.max(0, Math.min(offset - 1, lines.length));
  const count = Math.max(0, Math.min(length, lines.length - start));
  const insert = content === '' ? [] : content.split('\n');
  return [...lines.slice(0, start), ...insert, ...lines.slice(start + count)].join('\n');
}

// ─── wall-clock deadline for tree walks ──────────────────────────────────────

export type Deadline = { expired: () => boolean };

/** A deadline `timeoutMs` from now. Grep/find poll `expired()` and stop with a
 *  `timeout_ms` cap note rather than throwing, so partial results survive. */
export function deadline(timeoutMs: number): Deadline {
  const end = Date.now() + timeoutMs;
  return { expired: () => Date.now() > end };
}

/** Structured "a cap bit here" note merged into a tool result, telling the
 *  model which limit truncated it and how to ask for more. */
export function capNote(cap: string, limit: number): { truncated: true; cap: string; limit: number; hint: string } {
  return {
    truncated: true,
    cap,
    limit,
    hint: `output was capped by ${cap} (${limit}); retry with quota_override.${cap} set higher to request more (needs user approval)`,
  };
}

// ─── small param helpers (kept local so fs.ts stays untouched) ───────────────

export function asObject(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>;
}

export function requireString(o: Record<string, unknown>, key: string, tool: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new Error(`${tool}: \`${key}\` (non-empty string) is required`);
  return v;
}

export function optPositiveInt(o: Record<string, unknown>, key: string, tool: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`${tool}: \`${key}\` must be a positive integer`);
  }
  return v;
}

export function optNonNegInt(o: Record<string, unknown>, key: string, tool: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error(`${tool}: \`${key}\` must be a non-negative integer`);
  }
  return v;
}

export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string' && e.length > 0) : [];
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

// ─── governance (reserved params injected by the harness rules profile) ──────

function cap(o: Record<string, unknown>, key: string, fallback: number): number {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;
}

export type ReadGovernance = {
  allowedRoots: string[];
  maxReadBytes: number;
  maxListEntries: number;
  maxGrepResults: number;
  maxFindResults: number;
  maxGrepFileBytes: number;
  timeoutMs: number;
};

export const READ_GOVERNANCE_KEYS = [
  'allowed_roots',
  'max_read_bytes',
  'max_list_entries',
  'max_grep_results',
  'max_find_results',
  'max_grep_file_bytes',
  'timeout_ms',
] as const;

export function readGovernance(o: Record<string, unknown>): ReadGovernance {
  const allowed = stringArray(o.allowed_roots);
  return {
    // Empty allowed_roots = the runtime's own working directory (no machine
    // paths baked into rules), matching the original filesystem tool.
    allowedRoots: allowed.length > 0 ? allowed : [process.cwd()],
    maxReadBytes: cap(o, 'max_read_bytes', 200_000),
    maxListEntries: cap(o, 'max_list_entries', 500),
    maxGrepResults: cap(o, 'max_grep_results', 200),
    maxFindResults: cap(o, 'max_find_results', 200),
    maxGrepFileBytes: cap(o, 'max_grep_file_bytes', 2_000_000),
    timeoutMs: cap(o, 'timeout_ms', 2_000),
  };
}

export type WriteGovernance = {
  writableRoots: string[];
  maxWriteBytes: number;
  timeoutMs: number;
};

export const WRITE_GOVERNANCE_KEYS = ['writable_roots', 'max_write_bytes', 'timeout_ms'] as const;

export function writeGovernance(o: Record<string, unknown>): WriteGovernance {
  return {
    writableRoots: stringArray(o.writable_roots),
    maxWriteBytes: cap(o, 'max_write_bytes', 5_000_000),
    timeoutMs: cap(o, 'timeout_ms', 2_000),
  };
}

// ─── deadline/signal-aware file collection for grep & find ───────────────────

/** Walk `dir` collecting file paths, skipping dotfiles and node_modules (never
 *  a search target, very heavy). Returns false if the deadline cut the walk
 *  short (→ the caller reports a timeout_ms cap). Throws on a real cancel. */
export async function collectFiles(dir: string, out: string[], dl: Deadline, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  if (dl.expired()) return false;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (dl.expired()) return false;
    signal.throwIfAborted();
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!(await collectFiles(full, out, dl, signal))) return false;
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return true;
}
