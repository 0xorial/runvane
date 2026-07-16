import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContextInjectionService } from '../../../backend/src/context-injection/context-injection.service';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

/**
 * Discovery is a bounded traversal for AI instruction files — NOT a flat root
 * grab. These tests pin the rules: instruction names at any depth, the
 * .github/copilot and .cursor/rules conventions, root README (root only),
 * no manifests/lint configs, skip-dirs never entered, depth capped.
 */
describeLive('context-injection scan (traversal rules)', () => {
  const service = new ContextInjectionService();
  let root: string;

  async function put(relPath: string, content = `content of ${relPath}`): Promise<void> {
    const abs = path.join(root, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ctx-scan-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds instruction files at any depth, README at root only, and ignores non-instruction files', async () => {
    await put('CLAUDE.md');
    await put('README.md');
    await put('package.json', '{"name":"x"}');
    await put('.prettierrc', '{}');
    await put('.env.example', 'A=1');
    await put('backend/AGENTS.md');
    await put('backend/README.md'); // nested README — not a candidate
    await put('packages/deep/GEMINI.md');
    await put('.github/copilot-instructions.md');
    await put('.cursor/rules/style.mdc');
    await put('.cursor/other.mdc'); // .mdc outside rules/ — not a candidate
    await put('node_modules/lib/CLAUDE.md'); // skip-dir — never entered
    await put('.hidden/CLAUDE.md'); // hidden dir (not allow-listed) — never entered

    const result = await service.scan({ mode: 'all' }, root);
    expect(result).not.toBeNull();
    const paths = result!.files.map((f) => f.path).sort();
    expect(paths).toEqual(
      [
        'CLAUDE.md',
        'README.md',
        '.github/copilot-instructions.md',
        '.cursor/rules/style.mdc',
        'backend/AGENTS.md',
        'packages/deep/GEMINI.md',
      ].sort(),
    );
    expect(result!.files.every((f) => f.status === 'injected')).toBe(true);
    const readme = result!.files.find((f) => f.path === 'README.md');
    expect(readme?.fileType).toBe('readme');
    const nested = result!.files.find((f) => f.path === 'backend/AGENTS.md');
    expect(nested?.fileType).toBe('instructions');
    // The planner blob carries each file under its section header.
    expect(result!.content).toContain('--- backend/AGENTS.md ---');
  });

  it("mode 'selected' gates by category: instructions only leaves the README as a skipped audit row", async () => {
    await put('CLAUDE.md');
    await put('README.md');

    const result = await service.scan({ mode: 'selected', types: ['instructions'] }, root);
    expect(result).not.toBeNull();
    expect(result!.files).toEqual([
      { path: 'CLAUDE.md', fileType: 'instructions', status: 'injected' },
      { path: 'README.md', fileType: 'readme', status: 'skipped' },
    ]);
    expect(result!.content).not.toContain('README.md');
  });

  it('stops at the depth cap: dirs more than MAX_DEPTH levels down are never entered', async () => {
    await put('a/b/c/d/e/CLAUDE.md'); // inside a depth-5 dir — still found
    await put('a/b/c/d/e/f/CLAUDE.md'); // dir at depth 6 — never entered

    const result = await service.scan({ mode: 'all' }, root);
    expect(result!.files.map((f) => f.path)).toEqual(['a/b/c/d/e/CLAUDE.md']);
  });

  it('scanSelected reads only requested discovered paths — arbitrary paths never resolve', async () => {
    await put('CLAUDE.md');
    await put('backend/AGENTS.md');
    await put('secret.txt', 'not a candidate');

    const result = await service.scanSelected(['backend/AGENTS.md', 'secret.txt', '../etc/passwd'], root);
    expect(result).not.toBeNull();
    expect(result!.files).toEqual([{ path: 'backend/AGENTS.md', fileType: 'instructions', status: 'injected' }]);
  });

  it('an empty selection yields no result (explicit "inject nothing")', async () => {
    await put('CLAUDE.md');
    expect(await service.scanSelected([], root)).toBeNull();
  });
});
