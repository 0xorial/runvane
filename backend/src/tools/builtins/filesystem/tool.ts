import { Injectable } from '@nestjs/common';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, type ToolLocation, type ToolRunContext } from '../../base-tool.js';
import { zerialize } from 'zodex';
import { filesystemParamsSchema, parseFilesystemToolParams, type FilesystemToolParams } from './params.js';
import { FilesystemToolRulesSchema, parseFilesystemToolRules, type FilesystemToolRules } from './rules.js';
import { resolveAllowedPath, resolveWritablePath } from './path-access.js';
import { unifiedDiff } from './diff.js';

type ListDirEntry = {
  name: string;
  kind: 'file' | 'directory' | 'other';
};

type ReadFileResult = {
  operation: 'read_file';
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  // Present only for ranged reads (offset/limit), so the model can page.
  startLine?: number;
  endLine?: number;
  totalLines?: number;
};

type ListDirResult = {
  operation: 'list_dir';
  path: string;
  entries: ListDirEntry[];
  truncated: boolean;
};

type GrepHit = {
  file: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
};

type GrepResult = {
  operation: 'grep';
  path: string;
  pattern: string;
  hits: GrepHit[];
  count: number;
  filesScanned: number;
  // true when the result cap was hit (more matches may exist).
  truncated: boolean;
};

type StatResult = {
  operation: 'stat';
  path: string;
  kind: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs: number;
  // Only computed for text files small enough to scan.
  lineCount?: number;
};

type WriteFileResult = {
  operation: 'write_file';
  path: string;
  created: boolean;
  bytesWritten: number;
};

type EditFileResult = {
  operation: 'edit_file';
  path: string;
  replacements: number;
  diff: string;
};

// Cap on the characters of any single returned line, so a minified/one-line
// file can't blow the token budget through grep or ranged reads.
const MAX_LINE_LENGTH = 1000;

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

@Injectable()
export class FilesystemTool extends BaseTool<FilesystemToolParams, FilesystemToolRules> {
  getLocation(): ToolLocation {
    return 'target';
  }

  getName(): string {
    return 'filesystem';
  }

  getAiDescription(): string {
    return (
      'Read, search, and modify files on the host filesystem within configured roots. ' +
      'Operations: read_file (whole file, or a line range via offset/limit), list_dir, grep (find matching lines under a path — far cheaper than reading whole files), stat (size/mtime/line count), ' +
      'write_file (write content to a path, creating parent dirs and overwriting), edit_file (replace an exact old_string with new_string and return a diff — prefer this over rewriting a whole file). ' +
      'Reads are limited to allowed roots; writes are limited to writable roots (and are disabled unless a writable root is configured).'
    );
  }

  getHumanDescription(): string {
    return 'Read, search, write, and edit files within allowed roots.';
  }

  getParamsSchema(): unknown {
    return filesystemParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(FilesystemToolRulesSchema);
  }

  getDefaultRules(): FilesystemToolRules {
    return {
      allowed_roots: [process.cwd()],
      // Writes are opt-in: an agent owner must add a writable root explicitly,
      // so enabling the tool for reads never silently grants writes.
      writable_roots: [],
      max_read_bytes: 200_000,
      max_list_entries: 500,
      max_grep_results: 200,
      max_grep_file_bytes: 2_000_000,
    };
  }

  parseParams(raw: unknown): FilesystemToolParams {
    return parseFilesystemToolParams(raw);
  }

  parseRules(raw: unknown): FilesystemToolRules {
    return parseFilesystemToolRules(raw);
  }

  async runTool(
    params: FilesystemToolParams,
    context: ToolRunContext,
  ): Promise<ReadFileResult | ListDirResult | GrepResult | StatResult | WriteFileResult | EditFileResult> {
    const rules = parseFilesystemToolRules(context.toolRules ?? this.getDefaultRules());

    // Writes resolve against writable_roots (fail-closed when unset); reads
    // against allowed_roots. Keeping the roots separate is the safety seam:
    // enabling the tool for reads never grants writes.
    if (params.operation === 'write_file' || params.operation === 'edit_file') {
      const targetPath = await resolveWritablePath(params.path, rules.writable_roots);
      context.log?.(`${params.operation} ${targetPath}`);
      return params.operation === 'write_file'
        ? this.writeFile(targetPath, params)
        : this.editFile(targetPath, params);
    }

    const targetPath = await resolveAllowedPath(params.path, rules.allowed_roots);
    context.log?.(`${params.operation} ${targetPath}`);

    switch (params.operation) {
      case 'read_file':
        return this.readFile(targetPath, params, rules);
      case 'list_dir':
        return this.listDir(targetPath, rules);
      case 'grep':
        return this.grep(targetPath, params, rules, context);
      case 'stat':
        return this.statPath(targetPath, rules);
    }
  }

  private async writeFile(targetPath: string, params: FilesystemToolParams): Promise<WriteFileResult> {
    if (params.content === undefined) {
      throw new Error('filesystem: write_file requires `content`');
    }
    const existed = await stat(targetPath).then((s) => s.isFile(), () => false);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, params.content, 'utf8');
    return {
      operation: 'write_file',
      path: targetPath,
      created: !existed,
      bytesWritten: Buffer.byteLength(params.content, 'utf8'),
    };
  }

  private async editFile(targetPath: string, params: FilesystemToolParams): Promise<EditFileResult> {
    if (params.old_string === undefined) {
      throw new Error('filesystem: edit_file requires `old_string`');
    }
    const newString = params.new_string ?? '';
    const entryStat = await stat(targetPath).catch(() => null);
    if (!entryStat?.isFile()) {
      throw new Error(`filesystem: edit_file requires an existing file, got ${params.path}`);
    }
    const before = (await readFile(targetPath)).toString('utf8');
    const occurrences = countOccurrences(before, params.old_string);
    if (occurrences === 0) {
      throw new Error('filesystem: edit_file old_string not found in file');
    }
    if (occurrences > 1 && !params.replace_all) {
      throw new Error(
        `filesystem: edit_file old_string appears ${occurrences} times — pass replace_all: true, or include more surrounding text to make it unique`,
      );
    }
    const after = params.replace_all
      ? before.split(params.old_string).join(newString)
      : before.replace(params.old_string, newString);
    await writeFile(targetPath, after, 'utf8');
    return {
      operation: 'edit_file',
      path: targetPath,
      replacements: params.replace_all ? occurrences : 1,
      diff: unifiedDiff(before, after, path.basename(targetPath)),
    };
  }

  private async readFile(
    targetPath: string,
    params: FilesystemToolParams,
    rules: FilesystemToolRules,
  ): Promise<ReadFileResult> {
    const entryStat = await stat(targetPath);
    if (!entryStat.isFile()) {
      throw new Error(`filesystem: read_file requires a file path, got ${params.path}`);
    }

    const maxBytes = Math.min(params.max_bytes ?? rules.max_read_bytes, rules.max_read_bytes);
    const buf = await readFile(targetPath);

    // Ranged read: slice by line so the model can read exactly the region it
    // needs (e.g. the lines grep pointed at) and page large files.
    if (params.offset !== undefined || params.limit !== undefined) {
      const lines = buf.toString('utf8').split('\n');
      const totalLines = lines.length;
      const start = Math.min((params.offset ?? 1) - 1, totalLines);
      const end = params.limit !== undefined ? Math.min(start + params.limit, totalLines) : totalLines;
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

  private async listDir(targetPath: string, rules: FilesystemToolRules): Promise<ListDirResult> {
    const entryStat = await stat(targetPath);
    if (!entryStat.isDirectory()) {
      throw new Error(`filesystem: list_dir requires a directory path, got ${targetPath}`);
    }

    const names = await readdir(targetPath);
    const capped = names.slice(0, rules.max_list_entries);
    const entries: ListDirEntry[] = await Promise.all(
      capped.map(async (name) => {
        const childPath = path.join(targetPath, name);
        const childStat = await stat(childPath);
        const kind: ListDirEntry['kind'] = childStat.isDirectory()
          ? 'directory'
          : childStat.isFile()
            ? 'file'
            : 'other';
        return { name, kind };
      }),
    );

    return {
      operation: 'list_dir',
      path: targetPath,
      entries,
      truncated: names.length > rules.max_list_entries,
    };
  }

  private async statPath(targetPath: string, rules: FilesystemToolRules): Promise<StatResult> {
    const entryStat = await stat(targetPath);
    const kind: StatResult['kind'] = entryStat.isDirectory()
      ? 'directory'
      : entryStat.isFile()
        ? 'file'
        : 'other';

    let lineCount: number | undefined;
    // Only count lines for text-sized files we're willing to read; gives the
    // model the totals it needs to drive offset/limit without a full read.
    if (kind === 'file' && entryStat.size <= rules.max_grep_file_bytes) {
      const buf = await readFile(targetPath);
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

  private async grep(
    targetPath: string,
    params: FilesystemToolParams,
    rules: FilesystemToolRules,
    context: ToolRunContext,
  ): Promise<GrepResult> {
    if (!params.pattern) throw new Error('filesystem: grep requires a pattern');
    const maxResults = Math.min(params.max_results ?? rules.max_grep_results, rules.max_grep_results);
    const contextLines = params.context_lines ?? 0;
    const caseSensitive = params.case_sensitive ?? false;

    let matches: (line: string) => boolean;
    if (params.is_regex) {
      let re: RegExp;
      try {
        re = new RegExp(params.pattern, caseSensitive ? '' : 'i');
      } catch (err) {
        throw new Error(`filesystem: invalid regex — ${err instanceof Error ? err.message : String(err)}`);
      }
      matches = (line) => re.test(line);
    } else {
      const needle = caseSensitive ? params.pattern : params.pattern.toLowerCase();
      matches = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
    }

    const rootStat = await stat(targetPath);
    const files: string[] = [];
    if (rootStat.isFile()) {
      files.push(targetPath);
    } else if (rootStat.isDirectory()) {
      await this.collectFiles(targetPath, files, context.signal);
    } else {
      throw new Error(`filesystem: grep requires a file or directory, got ${targetPath}`);
    }
    // The base for hit `file` paths: the searched dir, or the file's parent.
    const base = rootStat.isDirectory() ? targetPath : path.dirname(targetPath);

    const hits: GrepHit[] = [];
    let filesScanned = 0;
    let truncated = false;

    for (const file of files) {
      context.signal?.throwIfAborted();
      if (hits.length >= maxResults) {
        truncated = true;
        break;
      }
      const fileStat = await stat(file).catch(() => null);
      if (!fileStat || fileStat.size > rules.max_grep_file_bytes) continue;
      const buf = await readFile(file).catch(() => null);
      if (!buf || buf.includes(0)) continue; // skip unreadable / binary
      filesScanned++;
      const lines = buf.toString('utf8').split('\n');
      const relative = path.relative(base, file) || path.basename(file);
      for (let i = 0; i < lines.length; i++) {
        if (!matches(lines[i])) continue;
        const hit: GrepHit = { file: relative, line: i + 1, text: capLine(lines[i]) };
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

    return {
      operation: 'grep',
      path: targetPath,
      pattern: params.pattern,
      hits,
      count: hits.length,
      filesScanned,
      truncated,
    };
  }

  // Recursive file walk for grep. Skips dotfiles (matching filesystem_index)
  // and node_modules — never the target of a content search and very heavy.
  private async collectFiles(dir: string, out: string[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collectFiles(full, out, signal);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
}
