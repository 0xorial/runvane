// zodex is ESM-only and only used by getRulesSchema (not exercised here);
// mock it so ts-jest can load the tool module under CommonJS.
jest.mock('zodex', () => ({ zerialize: (x: unknown) => x }));

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FilesystemTool } from './tool.js';
import type { ToolRunContext } from '../../base-tool.js';

function ctx(root: string): ToolRunContext {
  return {
    conversationId: 'c1',
    agentId: null,
    entries: [],
    toolRules: { allowed_roots: [root], max_read_bytes: 200_000, max_list_entries: 500, max_grep_results: 200, max_grep_file_bytes: 2_000_000 },
    signal: new AbortController().signal,
  };
}

describe('FilesystemTool grep / ranged read / stat', () => {
  const tool = new FilesystemTool();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fs-tool-'));
    await writeFile(path.join(root, 'a.txt'), 'line one\nNEEDLE here\nline three\nneedle lower\n');
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', 'b.txt'), 'nothing\nfound\n');
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'c.txt'), 'NEEDLE in node_modules\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('grep finds case-insensitive matches and skips node_modules', async () => {
    const res: any = await tool.runTool({ operation: 'grep', path: root, pattern: 'needle' }, ctx(root));
    expect(res.operation).toBe('grep');
    expect(res.count).toBe(2);
    const files = res.hits.map((h: any) => h.file).sort();
    expect(files).not.toContain(path.join('node_modules', 'c.txt'));
    expect(res.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'a.txt', line: 2, text: 'NEEDLE here' }),
        expect.objectContaining({ file: 'a.txt', line: 4, text: 'needle lower' }),
      ]),
    );
  });

  it('grep respects case_sensitive and returns context lines', async () => {
    const res: any = await tool.runTool(
      { operation: 'grep', path: root, pattern: 'NEEDLE', case_sensitive: true, context_lines: 1 },
      ctx(root),
    );
    expect(res.count).toBe(1);
    expect(res.hits[0]).toMatchObject({ file: 'a.txt', line: 2, before: ['line one'], after: ['line three'] });
  });

  it('grep supports regex', async () => {
    const res: any = await tool.runTool({ operation: 'grep', path: root, pattern: '^line', is_regex: true }, ctx(root));
    expect(res.count).toBe(2);
  });

  it('ranged read returns the requested line window with paging metadata', async () => {
    const res: any = await tool.runTool(
      { operation: 'read_file', path: path.join(root, 'a.txt'), offset: 2, limit: 2 },
      ctx(root),
    );
    expect(res.content).toBe('NEEDLE here\nline three');
    expect(res).toMatchObject({ startLine: 2, endLine: 3, totalLines: 5 });
  });

  it('stat reports kind, size, and line count', async () => {
    const res: any = await tool.runTool({ operation: 'stat', path: path.join(root, 'a.txt') }, ctx(root));
    expect(res).toMatchObject({ kind: 'file', lineCount: 4 });
    expect(res.size).toBeGreaterThan(0);
  });
});
