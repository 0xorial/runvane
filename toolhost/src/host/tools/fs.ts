import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TargetTool, TargetToolContext } from '../server.ts';

/**
 * THE filesystem tool — the only one in runvane. One tool dispatched on
 * `operation`, running wherever the tool-host lives (the app host for the
 * `local` sandbox, inside a container/remote box otherwise), so file access
 * always happens on the machine the conversation is sandboxed to.
 *
 * Governance arrives as reserved params injected by the harness-side rules
 * profile (never by the model — the harness overrides them unconditionally):
 * `allowed_roots`, `writable_roots`, `max_read_bytes`, `max_list_entries`,
 * `max_grep_results`, `max_grep_file_bytes`. Roots are enforced HERE with
 * realpath containment, because only this process sees the real filesystem
 * the paths refer to. Empty `allowed_roots` means the runtime's working
 * directory; empty `writable_roots` fails closed (writes disabled).
 */

type FsOperation = 'read_file' | 'list_dir' | 'grep' | 'stat' | 'write_file' | 'edit_file';
const OPERATIONS: FsOperation[] = ['read_file', 'list_dir', 'grep', 'stat', 'write_file', 'edit_file'];

const DEFAULT_MAX_READ_BYTES = 200_000;
const DEFAULT_MAX_LIST_ENTRIES = 500;
const DEFAULT_MAX_GREP_RESULTS = 200;
const DEFAULT_MAX_GREP_FILE_BYTES = 2_000_000;

// Cap on the characters of any single returned line, so a minified/one-line
// file can't blow the token budget through grep or ranged reads.
const MAX_LINE_LENGTH = 1000;

type Governance = {
  allowedRoots: string[];
  writableRoots: string[];
  maxReadBytes: number;
  maxListEntries: number;
  maxGrepResults: number;
  maxGrepFileBytes: number;
};

const GOVERNANCE_KEYS = [
  'allowed_roots',
  'writable_roots',
  'max_read_bytes',
  'max_list_entries',
  'max_grep_results',
  'max_grep_file_bytes',
] as const;

function asObject(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>;
}

function requireString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new Error(`filesystem: \`${key}\` (non-empty string) is required`);
  return v;
}

function optionalPositiveInt(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
    throw new Error(`filesystem: \`${key}\` must be a positive integer`);
  }
  return v;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string' && e.length > 0) : [];
}

function governance(o: Record<string, unknown>): Governance {
  const cap = (key: string, fallback: number): number => {
    const v = o[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;
  };
  const allowed = stringArray(o.allowed_roots);
  return {
    // Empty allowed_roots = the runtime's own working directory: the backend
    // cwd in the local home, the box's workdir in a container. No machine
    // paths baked into rules.
    allowedRoots: allowed.length > 0 ? allowed : [process.cwd()],
    writableRoots: stringArray(o.writable_roots),
    maxReadBytes: cap('max_read_bytes', DEFAULT_MAX_READ_BYTES),
    maxListEntries: cap('max_list_entries', DEFAULT_MAX_LIST_ENTRIES),
    maxGrepResults: cap('max_grep_results', DEFAULT_MAX_GREP_RESULTS),
    maxGrepFileBytes: cap('max_grep_file_bytes', DEFAULT_MAX_GREP_FILE_BYTES),
  };
}

// ─── path containment (realpath-based, defeats .. and symlink escapes) ───────

async function canonicalRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

function isUnderRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function resolveAllowedPath(requested: string, allowedRoots: string[]): Promise<string> {
  const trimmed = requested.trim();
  if (!trimmed) throw new Error('filesystem: path is required');
  if (allowedRoots.length === 0) throw new Error('filesystem: no allowed roots configured');

  const target = await fs.realpath(path.resolve(trimmed));
  for (const root of allowedRoots) {
    const rootPath = await canonicalRoot(root);
    if (isUnderRoot(target, rootPath)) return target;
  }
  throw new Error(`filesystem: path ${trimmed} is outside allowed roots`);
}

/**
 * Resolve a WRITE target against writable roots. The file may not exist yet,
 * so canonicalize the deepest existing ancestor (defeats `..` and symlink
 * escapes) and re-append the not-yet-existing tail. Empty writableRoots fails
 * closed — writes are disabled unless a root is configured.
 */
export async function resolveWritablePath(requested: string, writableRoots: string[]): Promise<string> {
  const trimmed = requested.trim();
  if (!trimmed) throw new Error('filesystem: path is required');
  if (writableRoots.length === 0) {
    throw new Error('filesystem: writes are disabled — no writable_roots configured for this agent');
  }

  const resolved = path.resolve(trimmed);
  let existing = resolved;
  const tail: string[] = [];
  for (;;) {
    const canon = await fs.realpath(existing).catch(() => null);
    if (canon) {
      const target = tail.length ? path.join(canon, ...tail) : canon;
      for (const root of writableRoots) {
        const rootPath = await canonicalRoot(root);
        if (isUnderRoot(target, rootPath)) return target;
      }
      throw new Error(`filesystem: path ${trimmed} is outside writable roots`);
    }
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  throw new Error(`filesystem: cannot resolve write path ${trimmed}`);
}

// ─── unified diff for edit_file results ──────────────────────────────────────

const DIFF_CONTEXT = 3;

export function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ctxStart = Math.max(0, start - DIFF_CONTEXT);
  const ctxEndA = Math.min(a.length, endA + DIFF_CONTEXT);
  const ctxEndB = Math.min(b.length, endB + DIFF_CONTEXT);

  const lines: string[] = [
    `--- ${label}`,
    `+++ ${label}`,
    `@@ -${ctxStart + 1},${ctxEndA - ctxStart} +${ctxStart + 1},${ctxEndB - ctxStart} @@`,
  ];
  for (let i = ctxStart; i < start; i++) lines.push(` ${a[i]}`);
  for (let i = start; i < endA; i++) lines.push(`-${a[i]}`);
  for (let i = start; i < endB; i++) lines.push(`+${b[i]}`);
  for (let i = endA; i < ctxEndA; i++) lines.push(` ${a[i]}`);
  return lines.join('\n');
}

// ─── operations ──────────────────────────────────────────────────────────────

function capLine(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

function countOccurrences(haystack: string, needle: string): number {
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

async function readFileOp(targetPath: string, o: Record<string, unknown>, gov: Governance) {
  const entryStat = await fs.stat(targetPath);
  if (!entryStat.isFile()) throw new Error(`filesystem: read_file requires a file path, got ${o.path}`);

  const requested = optionalPositiveInt(o, 'max_bytes');
  const maxBytes = Math.min(requested ?? gov.maxReadBytes, gov.maxReadBytes);
  const buf = await fs.readFile(targetPath);

  const offset = optionalPositiveInt(o, 'offset');
  const limit = optionalPositiveInt(o, 'limit');
  if (offset !== undefined || limit !== undefined) {
    const lines = buf.toString('utf8').split('\n');
    const totalLines = lines.length;
    const start = Math.min((offset ?? 1) - 1, totalLines);
    const end = limit !== undefined ? Math.min(start + limit, totalLines) : totalLines;
    const selected = lines.slice(start, end).join('\n');
    const selectedBuf = Buffer.from(selected, 'utf8');
    const truncated = selectedBuf.length > maxBytes;
    const content = truncated ? selectedBuf.subarray(0, maxBytes).toString('utf8') : selected;
    return {
      operation: 'read_file',
      path: targetPath,
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
      truncated,
      startLine: start + 1,
      endLine: end,
      totalLines,
    };
  }

  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return {
    operation: 'read_file',
    path: targetPath,
    content: slice.toString('utf8'),
    bytes: slice.length,
    truncated,
  };
}

async function listDirOp(targetPath: string, gov: Governance) {
  const entryStat = await fs.stat(targetPath);
  if (!entryStat.isDirectory()) throw new Error(`filesystem: list_dir requires a directory path, got ${targetPath}`);

  const names = await fs.readdir(targetPath);
  const capped = names.slice(0, gov.maxListEntries);
  const entries = await Promise.all(
    capped.map(async (name) => {
      const childStat = await fs.stat(path.join(targetPath, name));
      const kind = childStat.isDirectory() ? 'directory' : childStat.isFile() ? 'file' : 'other';
      return { name, kind };
    }),
  );

  return { operation: 'list_dir', path: targetPath, entries, truncated: names.length > gov.maxListEntries };
}

async function statOp(targetPath: string, gov: Governance) {
  const entryStat = await fs.stat(targetPath);
  const kind = entryStat.isDirectory() ? 'directory' : entryStat.isFile() ? 'file' : 'other';

  let lineCount: number | undefined;
  if (kind === 'file' && entryStat.size <= gov.maxGrepFileBytes) {
    const buf = await fs.readFile(targetPath);
    if (!buf.includes(0)) {
      let count = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++;
      lineCount = buf.length === 0 ? 0 : count + (buf[buf.length - 1] === 0x0a ? 0 : 1);
    }
  }

  return {
    operation: 'stat',
    path: targetPath,
    kind,
    size: entryStat.size,
    mtimeMs: entryStat.mtimeMs,
    ...(lineCount !== undefined ? { lineCount } : {}),
  };
}

async function collectFiles(dir: string, out: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip dotfiles (matching filesystem_index) and node_modules — never the
    // target of a content search and very heavy.
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, out, signal);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

async function grepOp(targetPath: string, o: Record<string, unknown>, gov: Governance, ctx: TargetToolContext) {
  const pattern = typeof o.pattern === 'string' && o.pattern.length > 0 ? o.pattern : null;
  if (!pattern) throw new Error('filesystem: grep requires a pattern');
  const maxResults = Math.min(optionalPositiveInt(o, 'max_results') ?? gov.maxGrepResults, gov.maxGrepResults);
  const contextLines = typeof o.context_lines === 'number' ? Math.min(Math.max(0, Math.floor(o.context_lines)), 10) : 0;
  const caseSensitive = o.case_sensitive === true;

  let matches: (line: string) => boolean;
  if (o.is_regex === true) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch (err) {
      throw new Error(`filesystem: invalid regex — ${err instanceof Error ? err.message : String(err)}`);
    }
    matches = (line) => re.test(line);
  } else {
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    matches = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
  }

  const rootStat = await fs.stat(targetPath);
  const files: string[] = [];
  if (rootStat.isFile()) {
    files.push(targetPath);
  } else if (rootStat.isDirectory()) {
    await collectFiles(targetPath, files, ctx.signal);
  } else {
    throw new Error(`filesystem: grep requires a file or directory, got ${targetPath}`);
  }
  const base = rootStat.isDirectory() ? targetPath : path.dirname(targetPath);

  const hits: Array<{ file: string; line: number; text: string; before?: string[]; after?: string[] }> = [];
  let filesScanned = 0;
  let truncated = false;

  for (const file of files) {
    ctx.signal.throwIfAborted();
    if (hits.length >= maxResults) {
      truncated = true;
      break;
    }
    const fileStat = await fs.stat(file).catch(() => null);
    if (!fileStat || fileStat.size > gov.maxGrepFileBytes) continue;
    const buf = await fs.readFile(file).catch(() => null);
    if (!buf || buf.includes(0)) continue;
    filesScanned++;
    const lines = buf.toString('utf8').split('\n');
    const relative = path.relative(base, file) || path.basename(file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || !matches(line)) continue;
      const hit: (typeof hits)[number] = { file: relative, line: i + 1, text: capLine(line) };
      if (contextLines > 0) {
        hit.before = lines.slice(Math.max(0, i - contextLines), i).map(capLine);
        hit.after = lines.slice(i + 1, i + 1 + contextLines).map(capLine);
      }
      hits.push(hit);
      if (hits.length >= maxResults) {
        truncated = true;
        break;
      }
    }
  }

  return { operation: 'grep', path: targetPath, pattern, hits, count: hits.length, filesScanned, truncated };
}

async function writeFileOp(targetPath: string, o: Record<string, unknown>) {
  if (typeof o.content !== 'string') throw new Error('filesystem: write_file requires `content`');
  const existed = await fs.stat(targetPath).then((s) => s.isFile(), () => false);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, o.content, 'utf8');
  return {
    operation: 'write_file',
    path: targetPath,
    created: !existed,
    bytesWritten: Buffer.byteLength(o.content, 'utf8'),
  };
}

async function editFileOp(targetPath: string, o: Record<string, unknown>) {
  const oldString = requireString(o, 'old_string');
  const newString = typeof o.new_string === 'string' ? o.new_string : '';
  const replaceAll = o.replace_all === true;

  const entryStat = await fs.stat(targetPath).catch(() => null);
  if (!entryStat?.isFile()) throw new Error(`filesystem: edit_file requires an existing file, got ${o.path}`);

  const before = (await fs.readFile(targetPath)).toString('utf8');
  const occurrences = countOccurrences(before, oldString);
  if (occurrences === 0) throw new Error('filesystem: edit_file old_string not found in file');
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `filesystem: edit_file old_string appears ${occurrences} times — pass replace_all: true, or include more surrounding text to make it unique`,
    );
  }
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
  await fs.writeFile(targetPath, after, 'utf8');
  return {
    operation: 'edit_file',
    path: targetPath,
    replacements: replaceAll ? occurrences : 1,
    diff: unifiedDiff(before, after, path.basename(targetPath)),
  };
}

// ─── the tool ────────────────────────────────────────────────────────────────

export const filesystemTool: TargetTool = {
  name: 'filesystem',
  aiDescription:
    'Read, search, and modify files where this conversation\'s sandbox lives. ' +
    'Operations: read_file (whole file, or a line range via offset/limit), list_dir, grep (find matching lines under a path — far cheaper than reading whole files), stat (size/mtime/line count), ' +
    'write_file (write content to a path, creating parent dirs and overwriting), edit_file (replace an exact old_string with new_string and return a diff — prefer this over rewriting a whole file). ' +
    'Reads are limited to allowed roots; writes are limited to writable roots (and are disabled unless a writable root is configured).',
  humanDescription: 'Read, search, write, and edit files in the sandbox.',
  paramsSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: OPERATIONS,
        description:
          'read_file returns text content (optionally a line range); list_dir returns directory entries; ' +
          'grep searches file contents under path and returns only matching lines; stat returns metadata (size, mtime, line count); ' +
          'write_file writes content to a path (creating parent dirs), overwriting any existing file; ' +
          'edit_file replaces an exact string in a file and returns a diff.',
      },
      path: {
        type: 'string',
        description: 'Absolute or relative path in the sandbox filesystem. For grep, the file or directory to search.',
      },
      content: { type: 'string', description: 'File contents to write (write_file only). Written verbatim as UTF-8.' },
      old_string: {
        type: 'string',
        description: 'Exact text to replace (edit_file only). Must appear exactly once unless replace_all is set.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text (edit_file only). May be empty to delete old_string.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence of old_string instead of requiring a unique match (edit_file only). Default false.',
      },
      max_bytes: { type: 'number', description: 'Optional read cap in bytes (read_file only).' },
      offset: { type: 'number', description: '1-based start line for a ranged read (read_file only). Omit to start at line 1.' },
      limit: {
        type: 'number',
        description: 'Number of lines to return from offset (read_file only). Omit to read to EOF (subject to max_bytes).',
      },
      pattern: { type: 'string', description: 'Search pattern (grep only). Literal substring unless is_regex is set.' },
      is_regex: { type: 'boolean', description: 'Treat pattern as a JS regular expression (grep only). Default false.' },
      case_sensitive: { type: 'boolean', description: 'Case-sensitive match (grep only). Default false.' },
      context_lines: {
        type: 'number',
        description: 'Lines of surrounding context to include with each grep hit (grep only). Default 0, max 10.',
      },
      max_results: { type: 'number', description: 'Cap on grep hits returned (grep only).' },
    },
    required: ['operation', 'path'],
  },
  async run(raw, ctx) {
    const o = asObject(raw);
    const operation = requireString(o, 'operation') as FsOperation;
    if (!OPERATIONS.includes(operation)) {
      throw new Error(`filesystem: unknown operation '${operation}' (expected ${OPERATIONS.join(', ')})`);
    }
    const requested = requireString(o, 'path');
    const gov = governance(o);
    for (const key of GOVERNANCE_KEYS) delete o[key];

    if (operation === 'write_file' || operation === 'edit_file') {
      const targetPath = await resolveWritablePath(requested, gov.writableRoots);
      ctx.log(`${operation} ${targetPath}`);
      return operation === 'write_file' ? writeFileOp(targetPath, o) : editFileOp(targetPath, o);
    }

    const targetPath = await resolveAllowedPath(requested, gov.allowedRoots);
    ctx.log(`${operation} ${targetPath}`);

    switch (operation) {
      case 'read_file':
        return readFileOp(targetPath, o, gov);
      case 'list_dir':
        return listDirOp(targetPath, gov);
      case 'grep':
        return grepOp(targetPath, o, gov, ctx);
      case 'stat':
        return statOp(targetPath, gov);
    }
  },
};
