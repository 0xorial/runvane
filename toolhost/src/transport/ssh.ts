import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { HarnessToHost, HostToHarness } from '../protocol/messages.ts';
import type { HarnessChannel } from './channel.ts';
import { spawnChannel } from './childProcess.ts';

export type SshTarget = {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  /** Command that starts the tool-host on the remote, reading stdin / writing stdout. */
  remoteCommand?: string;
  /** Extra `ssh` flags, inserted before the destination. */
  extraSshArgs?: string[];
};

export type SshConnection = { channel: HarnessChannel; child: ChildProcessWithoutNullStreams };

/**
 * Connect to an external tool-host over ssh. ssh provides the encrypted channel
 * (ssl); the wire is identical to the local child transport — we just spawn
 * `ssh` instead of `node`. The remote must expose the host command on PATH
 * (defaults to `runvane-toolhost`).
 */
export function connectSsh(target: SshTarget): SshConnection {
  const destination = target.user ? `${target.user}@${target.host}` : target.host;
  const remoteCommand = target.remoteCommand ?? 'runvane-toolhost';

  const args: string[] = ['-T', '-o', 'BatchMode=yes'];
  if (target.port) args.push('-p', String(target.port));
  if (target.identityFile) args.push('-i', target.identityFile);
  if (target.extraSshArgs) args.push(...target.extraSshArgs);
  args.push(destination, remoteCommand);

  const { channel, child } = spawnChannel<HostToHarness, HarnessToHost>('ssh', args);
  return { channel, child };
}
