import { BashTool } from '../../../backend/src/tools/builtins/bash/tool.js';
import { retainSharedTestApp } from '../support/shared-app';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('tool progress (integration)', () => {
  let bash: BashTool;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    bash = testApp.app.get(BashTool);
  }, 30_000);

  it('bash streams stdout via onProgress while running, then returns the full result', async () => {
    const chunks: string[] = [];
    const context = {
      conversationId: 'conv-test',
      agentId: null,
      entries: [],
      toolRules: { working_dir: '', max_timeout_ms: 60_000, max_output_bytes: 100_000 },
      signal: AbortSignal.timeout(10_000),
      onProgress: (delta: string) => chunks.push(delta),
    };

    const result = (await bash.runTool(
      { command: 'printf "alpha\\n"; printf "beta\\n"' },
      context,
    )) as { stdout: string; exit_code: number; truncated: boolean };

    // Progress was streamed live as the command produced output…
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('alpha');
    expect(chunks.join('')).toContain('beta');

    // …and the final result still carries the complete, ordered output.
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
    expect(result.truncated).toBe(false);
  });

  it('does not require onProgress (optional)', async () => {
    const context = {
      conversationId: 'conv-test',
      agentId: null,
      entries: [],
      toolRules: { working_dir: '', max_timeout_ms: 60_000, max_output_bytes: 100_000 },
      signal: AbortSignal.timeout(10_000),
    };
    const result = (await bash.runTool({ command: 'printf "ok"' }, context)) as { stdout: string; exit_code: number };
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe('ok');
  });
});
