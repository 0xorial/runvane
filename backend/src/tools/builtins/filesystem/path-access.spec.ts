import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveAllowedPath } from './path-access.js';

describe('resolveAllowedPath', () => {
  it('allows paths under configured roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'runvane-fs-'));
    const nested = path.join(root, 'docs');
    await mkdir(nested);
    const file = path.join(nested, 'note.txt');
    await writeFile(file, 'hello');

    const resolved = await resolveAllowedPath(file, [root]);
    expect(resolved).toBe(await realpath(file));
  });

  it('rejects paths outside roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'runvane-fs-'));
    await expect(resolveAllowedPath('/etc/passwd', [root])).rejects.toThrow(/outside allowed roots/);
  });
});
