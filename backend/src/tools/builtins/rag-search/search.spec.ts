import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ragSearchFiles } from './search.js';

describe('ragSearchFiles', () => {
  it('finds matching lines under roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'runvane-rag-'));
    const nested = path.join(root, 'src');
    await mkdir(nested);
    await writeFile(path.join(nested, 'alpha.ts'), 'export const needle = 1;\nexport const other = 2;\n');

    const hits = await ragSearchFiles({
      query: 'needle',
      roots: [root],
      maxResults: 10,
      maxFileBytes: 10_000,
      pathPrefix: null,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toContain('alpha.ts');
    expect(hits[0]?.line).toBe(1);
  });
});
