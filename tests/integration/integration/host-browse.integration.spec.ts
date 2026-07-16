import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browseHostDirectory } from '../../../backend/src/tool-host/host-browse';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('host browse (mount picker backend)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'host-browse-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists only directories, dot-dirs after regular ones, with parent for navigation', async () => {
    await mkdir(path.join(root, 'beta'));
    await mkdir(path.join(root, 'alpha'));
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'file.txt'), 'not a dir');

    const result = await browseHostDirectory(root);
    expect(result.path).toBe(root);
    expect(result.parent).toBe(path.dirname(root));
    expect(result.error).toBeUndefined();
    expect(result.dirs.map((d) => d.name)).toEqual(['alpha', 'beta', '.hidden']);
    expect(result.dirs[0]!.path).toBe(path.join(root, 'alpha'));
  });

  it('reports unreadable/missing paths inline instead of failing the picker', async () => {
    const missing = await browseHostDirectory(path.join(root, 'nope'));
    expect(missing.dirs).toEqual([]);
    expect(missing.error).toBeTruthy();

    const relative = await browseHostDirectory('not/absolute');
    expect(relative.dirs).toEqual([]);
    expect(relative.error).toContain('absolute');
  });

  it('defaults to the process cwd and roots have no parent', async () => {
    const def = await browseHostDirectory(undefined);
    expect(def.path).toBe(process.cwd());

    const top = await browseHostDirectory('/');
    expect(top.parent).toBeNull();
  });
});
