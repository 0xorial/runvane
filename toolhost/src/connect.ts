import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { BrainToHost, HostToBrain } from './protocol/messages.ts';
import { ToolHostClient } from './client/client.ts';
import type { InvocationReporter } from './client/reporter.ts';
import { ToolHostServer } from './host/server.ts';
import type { RuntimeTool } from './host/server.ts';
import { defaultRuntimeTools } from './host/tools/index.ts';
import { linkedChannels } from './transport/inProcess.ts';
import { spawnChannel } from './transport/childProcess.ts';
import { connectSsh } from './transport/ssh.ts';
import type { SshTarget } from './transport/ssh.ts';

/**
 * The single option the server flips: run the tool-host directly (in the
 * server's own process), as a local child process, or refer to one running
 * externally over ssh. Same client surface for all three.
 */
export type ToolHostConfig =
  | { mode: 'in-process'; tools?: RuntimeTool[] }
  | { mode: 'child'; command?: string; args?: string[] }
  | { mode: 'ssh'; ssh: SshTarget };

export type ToolHostHandle = {
  client: ToolHostClient;
  /** Present for child/ssh modes (the spawned process). */
  child?: ChildProcess;
  close(): Promise<void>;
};

/** Path to the standalone host entrypoint that `child` / `ssh` hosts run. */
export function defaultHostEntry(): string {
  return fileURLToPath(new URL('./host/main.ts', import.meta.url));
}

/**
 * Connect to a tool-host per config and return a ready client. Rejects (rather
 * than hanging) if the host never comes up — e.g. ssh auth fails or the child
 * can't spawn.
 */
export async function connectToolHost(config: ToolHostConfig, reporter?: InvocationReporter): Promise<ToolHostHandle> {
  if (config.mode === 'in-process') {
    const { brain, host } = linkedChannels();
    new ToolHostServer(host, config.tools ?? defaultRuntimeTools()).start();
    const client = new ToolHostClient(brain, reporter);
    await client.ready();
    return { client, close: () => client.close() };
  }

  if (config.mode === 'child') {
    const command = config.command ?? process.execPath;
    const args = config.args ?? [defaultHostEntry()];
    const { channel, child } = spawnChannel<HostToBrain, BrainToHost>(command, args);
    const client = new ToolHostClient(channel, reporter);
    await client.ready();
    return { client, child, close: async () => void (await client.close(), child.kill()) };
  }

  const { channel, child } = connectSsh(config.ssh);
  const client = new ToolHostClient(channel, reporter);
  await client.ready();
  return { client, child, close: async () => void (await client.close(), child.kill()) };
}
