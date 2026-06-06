import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemIndexStore } from './filesystem-index-store.service.js';

describe('FilesystemIndexStore', () => {
  it('refresh and search find indexed relative paths', async () => {
    const store = new FilesystemIndexStore();
    const root = await mkdtemp(path.join(os.tmpdir(), 'runvane-idx-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'main.ts'), 'export {};\n');

    await store.refresh([root]);
    const hits = store.search('main.ts', 10);
    expect(hits.some((hit) => hit.relativePath.includes('main.ts'))).toBe(true);
  });
});
