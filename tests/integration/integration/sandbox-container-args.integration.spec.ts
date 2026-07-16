import {
  buildRunArgs,
  DEFAULT_SANDBOX_IMAGE,
  sandboxContainerName,
  sshConfigForContainer,
  validateMounts,
} from '../../../backend/src/tool-host/sandbox-container.args';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

/**
 * The docker-sandbox argv/config builders are pure — pin them here so the
 * e2e (which runs against a real daemon) only has to prove lifecycle, not
 * arg construction.
 */
describeLive('sandbox container args', () => {
  it('builds a docker run argv: detached plain box with caps, mounts, sleep-infinity PID 1', () => {
    const args = buildRunArgs({
      containerName: 'runvane-sbx-abc12345',
      image: DEFAULT_SANDBOX_IMAGE,
      mounts: [
        { host: '/data/project', container: '/workspace/project' },
        { host: '/data/ref', container: '/workspace/ref', readonly: true },
      ],
    });
    expect(args).toEqual([
      'run',
      '-d',
      '--name',
      'runvane-sbx-abc12345',
      '--hostname',
      'runvane-sbx-abc12345',
      '--restart',
      'unless-stopped',
      '--memory',
      '4g',
      '--pids-limit',
      '2048',
      '-v',
      '/data/project:/workspace/project',
      '-v',
      '/data/ref:/workspace/ref:ro',
      DEFAULT_SANDBOX_IMAGE,
      'sleep',
      'infinity',
    ]);
  });

  it('drops resource caps when the daemon cannot apply cgroup config', () => {
    const args = buildRunArgs({
      containerName: 'runvane-sbx-abc12345',
      image: DEFAULT_SANDBOX_IMAGE,
      mounts: [],
      withResourceCaps: false,
    });
    expect(args).not.toContain('--memory');
    expect(args).not.toContain('--pids-limit');
  });

  it('rejects relative mount paths on either side', () => {
    expect(validateMounts([{ host: 'data', container: '/w' }])).toContain('absolute');
    expect(validateMounts([{ host: '/data', container: 'w' }])).toContain('absolute');
    expect(validateMounts([{ host: '/data', container: '/w' }])).toBeNull();
  });

  it('registers the box as plain ssh riding docker exec (no ports, no TCP)', () => {
    const name = sandboxContainerName('sbx-abc12345');
    const ssh = sshConfigForContainer(name, '/keys/id_ed25519');
    expect(ssh).toEqual({
      host: 'runvane-sbx-abc12345',
      user: 'dev',
      identityFile: '/keys/id_ed25519',
      proxyCommand: 'docker exec -i -u root runvane-sbx-abc12345 /usr/sbin/sshd -i',
    });
    // No remoteCommand: the existing ssh machinery auto-deploys the tool-host.
    expect(ssh.remoteCommand).toBeUndefined();
    expect(ssh.port).toBeUndefined();
  });
});
