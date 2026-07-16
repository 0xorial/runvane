import path from 'node:path';
import type { DockerSandboxMount, SshSandboxConfig } from '../contracts/tool-sandbox.js';

/** Default image tag for runvane-managed sandboxes (built from sandbox/Dockerfile). */
export const DEFAULT_SANDBOX_IMAGE = 'runvane-sandbox:latest';

/** The non-root user baked into the sandbox image; ssh connects as it. */
export const SANDBOX_USER = 'dev';

/**
 * Container names must be stable and docker-safe. Derived from the sandbox id
 * (already url-safe) rather than the display name.
 */
export function sandboxContainerName(sandboxId: string): string {
  return `runvane-${sandboxId}`;
}

export function validateMounts(mounts: DockerSandboxMount[]): string | null {
  for (const mount of mounts) {
    if (!path.isAbsolute(mount.host)) return `mount host path must be absolute: ${mount.host}`;
    if (!path.isAbsolute(mount.container)) return `mount container path must be absolute: ${mount.container}`;
  }
  return null;
}

/**
 * `docker run` argv for a sandbox container. The container is a plain box:
 * `sleep infinity` as PID 1, restart with the daemon, modest resource caps.
 * sshd is NOT a daemon in it — each ssh session is served by `sshd -i` via
 * docker exec (see sshConfigForContainer), so there is nothing to keep alive.
 *
 * `withResourceCaps: false` drops the memory/pids limits: some daemons
 * (docker cgroup parent in threaded cgroupv2 mode) reject any cgroup
 * configuration — the service retries without caps and logs it.
 */
export function buildRunArgs(input: {
  containerName: string;
  image: string;
  mounts: DockerSandboxMount[];
  withResourceCaps?: boolean;
}): string[] {
  const args = [
    'run',
    '-d',
    '--name',
    input.containerName,
    '--hostname',
    input.containerName,
    '--restart',
    'unless-stopped',
  ];
  if (input.withResourceCaps ?? true) {
    args.push('--memory', '4g', '--pids-limit', '2048');
  }
  for (const mount of input.mounts) {
    args.push('-v', `${mount.host}:${mount.container}${mount.readonly ? ':ro' : ''}`);
  }
  args.push(input.image, 'sleep', 'infinity');
  return args;
}

/**
 * The ssh config registered for a docker sandbox. Real ssh (keys, channels,
 * sftp), but transported over `docker exec … sshd -i` instead of TCP — so it
 * works identically whether the daemon is dind beside the app, a sibling
 * daemon, or remote, with no published ports or bridge routing. The existing
 * ssh machinery then auto-deploys and runs the tool-host (ssh-deploy.ts).
 */
export function sshConfigForContainer(containerName: string, identityFile: string): SshSandboxConfig {
  return {
    host: containerName,
    user: SANDBOX_USER,
    identityFile,
    proxyCommand: `docker exec -i -u root ${containerName} /usr/sbin/sshd -i`,
  };
}
