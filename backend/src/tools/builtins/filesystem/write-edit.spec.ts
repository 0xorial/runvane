// zodex is ESM-only and only used by getRulesSchema (not exercised here);
// mock it so ts-jest can load the tool module under CommonJS.
jest.mock('zodex', () => ({ zerialize: (x: unknown) => x }));

import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FilesystemTool } from './tool.js';
import type { ToolRunContext } from '../../base-tool.js';

function ctx(root: string, writableRoots: string[]): ToolRunContext {
  return {
    conversationId: 'c1',
    agentId: null,
    entries: [],
    toolRules: {
      allowed_roots: [root],
      writable_roots: writableRoots,
      max_read_bytes: 200_000,
      max_list_entries: 500,
      max_grep_results: 200,
      max_grep_file_bytes: 2_000_000,
    },
    signal: new AbortController().signal,
  };
}

describe('FilesystemTool write_file / edit_file', () => {
  const tool = new FilesystemTool();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fs-write-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('write_file creates a new file (creating parent dirs) and reports created:true', async () => {
    const target = path.join(root, 'nested', 'new.txt');
    const res: any = await tool.runTool({ operation: 'write_file', path: target, content: 'hello\n' }, ctx(root, [root]));
    expect(res).toMatchObject({ operation: 'write_file', created: true, bytesWritten: 6 });
    expect(await readFile(target, 'utf8')).toBe('hello\n');
  });

  it('write_file overwrites an existing file and reports created:false', async () => {
    const target = path.join(root, 'f.txt');
    await writeFile(target, 'old', 'utf8');
    const res: any = await tool.runTool({ operation: 'write_file', path: target, content: 'new content' }, ctx(root, [root]));
    expect(res.created).toBe(false);
    expect(await readFile(target, 'utf8')).toBe('new content');
  });

  it('write_file is disabled when no writable_roots are configured', async () => {
    const target = path.join(root, 'f.txt');
    await expect(
      tool.runTool({ operation: 'write_file', path: target, content: 'x' }, ctx(root, [])),
    ).rejects.toThrow(/writes are disabled/i);
    await expect(stat(target)).rejects.toBeTruthy();
  });

  it('write_file rejects a readable-but-not-writable path', async () => {
    // root is readable (allowed_roots) but writable_roots points elsewhere.
    const other = await mkdtemp(path.join(tmpdir(), 'fs-writable-'));
    try {
      await expect(
        tool.runTool({ operation: 'write_file', path: path.join(root, 'f.txt'), content: 'x' }, ctx(root, [other])),
      ).rejects.toThrow(/outside writable roots/i);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('write_file rejects a ../ escape out of the writable root', async () => {
    const escape = path.join(root, 'sub', '..', '..', 'escape.txt');
    await expect(
      tool.runTool({ operation: 'write_file', path: escape, content: 'x' }, ctx(root, [path.join(root, 'sub')])),
    ).rejects.toThrow(/outside writable roots/i);
  });

  it('edit_file replaces a unique string and returns a unified diff', async () => {
    const target = path.join(root, 'code.txt');
    await writeFile(target, 'alpha\nbeta\ngamma\n', 'utf8');
    const res: any = await tool.runTool(
      { operation: 'edit_file', path: target, old_string: 'beta', new_string: 'BETA' },
      ctx(root, [root]),
    );
    expect(res).toMatchObject({ operation: 'edit_file', replacements: 1 });
    expect(await readFile(target, 'utf8')).toBe('alpha\nBETA\ngamma\n');
    expect(res.diff).toContain('-beta');
    expect(res.diff).toContain('+BETA');
  });

  it('edit_file errors when old_string is absent', async () => {
    const target = path.join(root, 'code.txt');
    await writeFile(target, 'alpha\n', 'utf8');
    await expect(
      tool.runTool({ operation: 'edit_file', path: target, old_string: 'missing', new_string: 'x' }, ctx(root, [root])),
    ).rejects.toThrow(/not found/i);
  });

  it('edit_file errors on an ambiguous match unless replace_all is set', async () => {
    const target = path.join(root, 'code.txt');
    await writeFile(target, 'x\nx\nx\n', 'utf8');
    await expect(
      tool.runTool({ operation: 'edit_file', path: target, old_string: 'x', new_string: 'y' }, ctx(root, [root])),
    ).rejects.toThrow(/appears 3 times/i);

    const res: any = await tool.runTool(
      { operation: 'edit_file', path: target, old_string: 'x', new_string: 'y', replace_all: true },
      ctx(root, [root]),
    );
    expect(res.replacements).toBe(3);
    expect(await readFile(target, 'utf8')).toBe('y\ny\ny\n');
  });

  it('edit_file requires an existing file', async () => {
    await expect(
      tool.runTool(
        { operation: 'edit_file', path: path.join(root, 'nope.txt'), old_string: 'a', new_string: 'b' },
        ctx(root, [root]),
      ),
    ).rejects.toThrow(/existing file/i);
  });
});
