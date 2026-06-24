import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import type { MessageChannel } from './channel.ts';
import { streamChannel } from './ndjson.ts';

export type ChildChannel<TIn, TOut> = {
  channel: MessageChannel<TIn, TOut>;
  child: ChildProcessWithoutNullStreams;
};

/**
 * Spawn a process and speak NDJSON over its stdio. This is the basis for both
 * a local host subprocess (`node src/host/main.ts`) and ssh — ssh is just
 * `spawn('ssh', [...])` with the same framing.
 *
 * stderr is forwarded to this process's stderr for diagnostics and never mixed
 * into the protocol stream (which is stdout-only).
 */
export function spawnChannel<TIn, TOut>(
  command: string,
  args: string[] = [],
  opts: SpawnOptions = {},
): ChildChannel<TIn, TOut> {
  const child = spawn(command, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    process.stderr.write(`[toolhost:${command}] ${d}`);
  });
  // A spawn failure (ENOENT, etc.) lands here; surface it through the channel's
  // close path by tearing down the stream the channel watches.
  child.on('error', (err: Error) => {
    child.stdout.destroy(err);
  });

  const channel = streamChannel<TIn, TOut>(child.stdout, child.stdin);
  return { channel, child };
}
