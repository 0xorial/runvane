import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ToolHostClient } from './tool-host-client.js';

const HOST_ENTRY = process.env.RUNVANE_TOOLHOST_HOST_ENTRY || path.resolve(process.cwd(), '../toolhost/src/host/main.ts');

// Exercises the real extracted host (spawned as a child). Skips where the
// package isn't on disk (e.g. CI that hasn't checked out the toolhost/ dir).
const suite = existsSync(HOST_ENTRY) ? describe : describe.skip;

suite('ToolHostClient (real toolhost/ host)', () => {
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

  it('runs a tool with streamed progress', async () => {
    let streamed = '';
    const result = await client.invoke('exec', { command: 'echo client-run' }, { onProgress: (d) => (streamed += d) });
    expect(result.ok).toBe(true);
    expect((result.output as { stdout: string }).stdout).toMatch(/client-run/);
    expect(streamed).toMatch(/client-run/);
  });

  it('propagates cancellation through the signal', async () => {
    const ac = new AbortController();
    const pending = client.invoke('exec', { command: 'sleep 10' }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('aborted');
  });
});
