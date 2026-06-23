import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesEntitySource } from './files.source.js';
import type { SourceItem } from './entity-source.js';

async function collect(source: FilesEntitySource, params: Record<string, unknown>): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  for await (const item of source.enumerate(params)) items.push(item);
  return items;
}

describe('FilesEntitySource', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'runvane-files-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(path.join(root, 'readme.md'), '# Title\n\nbody\n');
    await writeFile(path.join(root, 'image.png'), 'not text');
    await writeFile(path.join(root, '.hidden'), 'secret');
    await writeFile(path.join(root, 'empty.txt'), '   \n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('yields text files with stable ids, content hashes, and metadata', async () => {
    const items = await collect(new FilesEntitySource(), { roots: [root] });
    const byRel = new Map(items.map((i) => [i.metadata.relativePath, i]));
    expect([...byRel.keys()].sort()).toEqual(['readme.md', 'src/a.ts']);

    const a = byRel.get('src/a.ts')!;
    expect(a.sourceId).toBe(path.join(root, 'src', 'a.ts'));
    expect(a.contentHash).toMatch(/^[0-9a-f]{40}$/);
    expect(a.metadata.ext).toBe('.ts');
  });

  it('skips dotfiles, binary extensions, and empty files', async () => {
    const items = await collect(new FilesEntitySource(), { roots: [root] });
    const rels = items.map((i) => i.metadata.relativePath);
    expect(rels).not.toContain('image.png');
    expect(rels).not.toContain('.hidden');
    expect(rels).not.toContain('empty.txt');
  });

  it('respects maxFileBytes', async () => {
    const items = await collect(new FilesEntitySource(), { roots: [root], maxFileBytes: 5 });
    expect(items).toHaveLength(0);
  });

  it('throws when no roots are configured', async () => {
    await expect(collect(new FilesEntitySource(), { roots: [] })).rejects.toThrow(/no roots/);
  });
});
