import { remoteRunCommand } from './ssh-deploy.js';

describe('remoteRunCommand', () => {
  it('runs the shipped host through the login shell so node resolves from the user profile', () => {
    const cmd = remoteRunCommand('"$HOME/.cache/runvane-toolhost/abc123"');
    expect(cmd).toBe(
      'exec "${SHELL:-/bin/sh}" -lc \'exec node --experimental-strip-types "$HOME/.cache/runvane-toolhost/abc123"/host/main.ts\'',
    );
  });
});
