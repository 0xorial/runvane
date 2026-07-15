// zodex is ESM-only and only used by rulesSchema (not exercised here); mock it
// so ts-jest can load the module under CommonJS.
jest.mock('zodex', () => ({ zerialize: (x: unknown) => x }));

import { commandMatchesPrefix, execCommandAllowed, execRulesProfile } from './host-tool-rules.js';

describe('commandMatchesPrefix', () => {
  it('matches on a word boundary, not a bare prefix', () => {
    expect(commandMatchesPrefix('git log --oneline', 'git log')).toBe(true);
    expect(commandMatchesPrefix('git log', 'git log')).toBe(true);
    expect(commandMatchesPrefix('git logfoo', 'git log')).toBe(false);
    expect(commandMatchesPrefix('  ls -la', 'ls')).toBe(true);
    expect(commandMatchesPrefix('lsof', 'ls')).toBe(false);
  });
});

describe('execCommandAllowed', () => {
  const rules = execRulesProfile.parseRules({ allowed_prefixes: ['ls', 'git status'], ask_outside_allowlist: true, default_cwd: '' }) as any;

  it('allows an allowlisted command', () => {
    expect(execCommandAllowed('ls -la', rules)).toBe(true);
    expect(execCommandAllowed('git status', rules)).toBe(true);
  });

  it('rejects a non-allowlisted command', () => {
    expect(execCommandAllowed('rm -rf /', rules)).toBe(false);
  });

  it('rejects an allowlisted prefix chained past a shell operator', () => {
    expect(execCommandAllowed('ls; rm -rf /', rules)).toBe(false);
    expect(execCommandAllowed('ls && rm x', rules)).toBe(false);
    expect(execCommandAllowed('ls | tee /etc/passwd', rules)).toBe(false);
    expect(execCommandAllowed('ls $(rm x)', rules)).toBe(false);
    expect(execCommandAllowed('ls > /etc/hosts', rules)).toBe(false);
  });
});

describe('execRulesProfile.evaluate', () => {
  it('allows an allowlisted command under custom policy', () => {
    const res = execRulesProfile.evaluate({ command: 'ls -la' }, { allowed_prefixes: ['ls'] });
    expect(res[0].permission).toBe('allow');
  });

  it('asks for a command outside the allowlist by default', () => {
    const res = execRulesProfile.evaluate({ command: 'rm -rf /' }, { allowed_prefixes: ['ls'] });
    expect(res[0].permission).toBe('ask_user');
  });

  it('runs anything when ask_outside_allowlist is false', () => {
    const res = execRulesProfile.evaluate({ command: 'rm -rf /' }, { allowed_prefixes: [], ask_outside_allowlist: false });
    expect(res[0].permission).toBe('allow');
  });
});

describe('execRulesProfile.applyDefaults', () => {
  it('injects default_cwd when the command omits cwd', () => {
    const out = execRulesProfile.applyDefaults({ command: 'ls' }, { default_cwd: '/workspace' }) as any;
    expect(out.cwd).toBe('/workspace');
  });

  it('leaves an explicit cwd untouched', () => {
    const out = execRulesProfile.applyDefaults({ command: 'ls', cwd: '/repo' }, { default_cwd: '/workspace' }) as any;
    expect(out.cwd).toBe('/repo');
  });

  it('does nothing when default_cwd is empty', () => {
    const out = execRulesProfile.applyDefaults({ command: 'ls' }, {}) as any;
    expect(out.cwd).toBeUndefined();
  });
});
