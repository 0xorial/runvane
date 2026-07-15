import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRootCandidates } from './root-scanner.js';

describe('scanRootCandidates', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'runvane-scan-'));
    const put = async (rel: string, content = 'x') => {
      await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
      await writeFile(path.join(base, rel), content);
    };
    await put('README.md');
    await put('docs/testing.md');
    await put('docs/protocol.md');
    await put('src/app/main.ts');
    await put('src/app/util.ts');
    await put('src/app/deep/inner.ts');
    await put('node_modules/pkg/index.js');
    await put('dist/bundle.js');
    await put('.git/config');
    await put('assets/logo.png'); // not a text candidate
    await mkdir(path.join(base, 'empty'), { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('ranks candidates by indexable files and skips denylisted/dot/empty dirs', async () => {
    const candidates = await scanRootCandidates(base);
    const byRel = new Map(candidates.map((c) => [c.relative, c]));

    expect(byRel.get('src')?.files).toBe(3); // subtree rollup incl. deep/
    expect(byRel.get('docs')?.files).toBe(2);
    expect(byRel.get('')?.files).toBe(1); // base counts only its direct files
    for (const rel of ['node_modules', 'dist', '.git', 'assets', 'empty']) {
      expect(byRel.has(rel)).toBe(false);
    }
    // src/app mirrors src (>80% of the parent) → suppressed as redundant.
    expect(byRel.has('src/app')).toBe(false);
    expect(candidates[0]!.relative).toBe('src');
    expect(byRel.get('docs')?.samples).toEqual(expect.arrayContaining(['testing.md']));
  });

  it('returns [] for an unreadable base', async () => {
    expect(await scanRootCandidates(path.join(base, 'does-not-exist'))).toEqual([]);
  });
});
