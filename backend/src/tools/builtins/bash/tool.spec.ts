import { runBashCommand } from './run-command.js';
import { parseBashToolRules } from './rules.js';

const signal = new AbortController().signal;

describe('runBashCommand output handling', () => {
  it('caps output at the budget and appends a truncation notice', async () => {
    const r = await runBashCommand('for i in $(seq 1 5000); do echo "LINE_$i"; done', undefined, 60000, 200, signal);
    expect(r.exit_code).toBe(0);
    expect(r.truncated).toBe(true);
    expect(r.stdout).toContain('output truncated to 200 bytes');
    // Kept payload stays at the budget; the notice is appended just after it.
    expect(r.stdout.indexOf('[bash: output truncated')).toBeLessThanOrEqual(210);
  });

  it('leaves small output untouched (no notice)', async () => {
    const r = await runBashCommand('echo hello', undefined, 60000, 10000, signal);
    expect(r.truncated).toBe(false);
    expect(r.stdout).toBe('hello\n');
    expect(r.stdout).not.toContain('truncated');
  });
});

describe('bash rules', () => {
  it('defaults to a modest output cap so a stray dump cannot flood the context', () => {
    expect(parseBashToolRules({}).max_output_bytes).toBe(20000);
  });
});
