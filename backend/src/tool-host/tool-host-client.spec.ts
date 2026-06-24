import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { ChatEntry } from '../contracts/chatEntry.js';
import { HostToolProxy } from './host-tool-proxy.js';
import { ToolHostClient } from './tool-host-client.js';

const HOST_ENTRY =
  process.env.RUNVANE_TOOLHOST_HOST_ENTRY || path.resolve(process.cwd(), '../toolhost/src/host/main.ts');

// Exercises the real extracted host (spawned as a child). Skips where the
// package isn't on disk (e.g. CI that hasn't checked out /shared).
const suite = existsSync(HOST_ENTRY) ? describe : describe.skip;

function runContext(signal: AbortSignal, onProgress?: (d: string) => void) {
  return { conversationId: 'c1', agentId: 'a1', entries: [] as ChatEntry[], signal, onProgress };
}

suite('tool-host integration (real @runvane/toolhost host)', () => {
  jest.setTimeout(15000);
  let client: ToolHostClient;

  beforeAll(async () => {
    client = new ToolHostClient({ command: process.execPath, args: [HOST_ENTRY] });
    client.start();
    await client.ready();
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists runtime tools from the host', async () => {
    const tools = await client.listTools();
    expect(tools.some((t) => t.name === 'exec')).toBe(true);
    expect(tools.every((t) => t.runtime === 'runtime')).toBe(true);
  });

  it('runs a tool through HostToolProxy with streamed progress', async () => {
    const tools = await client.listTools();
    const descriptor = tools.find((t) => t.name === 'exec');
    expect(descriptor).toBeDefined();

    const proxy = new HostToolProxy(client, descriptor!);
    expect(proxy.getLocation()).toBe('runtime');

    let streamed = '';
    const output = await proxy.runTool(
      { command: 'echo backend-proxy' },
      runContext(new AbortController().signal, (d) => (streamed += d)),
    );
    expect((output as { stdout: string }).stdout).toMatch(/backend-proxy/);
    expect(streamed).toMatch(/backend-proxy/);
  });

  it('propagates cancellation through the run context signal', async () => {
    const tools = await client.listTools();
    const proxy = new HostToolProxy(client, tools.find((t) => t.name === 'exec')!);

    const ac = new AbortController();
    const pending = proxy.runTool({ command: 'sleep 10' }, runContext(ac.signal));
    setTimeout(() => ac.abort(), 100);

    await expect(pending).rejects.toThrow(/aborted/);
  });
});
