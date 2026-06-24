import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedChannels } from '../src/transport/inProcess.ts';
import { ToolHostServer } from '../src/host/server.ts';
import { defaultRuntimeTools } from '../src/host/tools/index.ts';
import { ToolHostClient } from '../src/client/client.ts';
import { createRuntimeToolProxies } from '../src/client/proxy.ts';

function connect(reporter?: ConstructorParameters<typeof ToolHostClient>[1]) {
  const { brain, host } = linkedChannels();
  new ToolHostServer(host, defaultRuntimeTools()).start();
  return new ToolHostClient(brain, reporter);
}

test('in-process: ready, list_tools, exec with streamed progress, ping', async () => {
  const client = connect();
  await client.ready();

  const tools = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'exec'));
  assert.equal(
    tools.every((t) => t.runtime === 'runtime'),
    true,
  );

  let streamed = '';
  const result = await client.invoke('exec', { command: 'printf "hello\\nworld\\n"' }, { onProgress: (d) => (streamed += d) });
  assert.equal(result.ok, true, result.error ?? '');
  const out = result.output as { exitCode: number; stdout: string };
  assert.equal(out.exitCode, 0);
  assert.match(out.stdout, /hello/);
  assert.match(streamed, /hello/);
  assert.match(streamed, /world/);

  const rtt = await client.ping();
  assert.ok(rtt >= 0);

  await client.close();
});

test('in-process: invocation lifecycle is reported (task-monitoring hook)', async () => {
  const events: string[] = [];
  const client = connect({
    onInvocationStart: (i) => events.push(`start:${i.toolName}`),
    onInvocationProgress: () => events.push('progress'),
    onInvocationEnd: (i) => events.push(`end:${i.result.ok}`),
  });
  await client.ready();

  await client.invoke('exec', { command: 'echo hi' });
  assert.equal(events[0], 'start:exec');
  assert.ok(events.includes('progress'));
  assert.equal(events.at(-1), 'end:true');

  await client.close();
});

test('in-process: runtime tool proxy runs the happy path', async () => {
  const client = connect();
  await client.ready();

  const proxies = createRuntimeToolProxies(client, await client.listTools());
  const exec = proxies.find((p) => p.name === 'exec');
  assert.ok(exec);
  assert.equal(exec.location, 'runtime');

  const out = await exec.run({ command: 'echo via-proxy' }, { signal: new AbortController().signal });
  assert.match((out as { stdout: string }).stdout, /via-proxy/);

  await client.close();
});

test('in-process: unknown tool resolves as a failure, not a throw', async () => {
  const client = connect();
  await client.ready();
  const result = await client.invoke('nope', {});
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Unknown tool/);
  await client.close();
});
