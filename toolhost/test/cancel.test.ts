import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedChannels } from '../src/transport/inProcess.ts';
import { ToolHostServer } from '../src/host/server.ts';
import { defaultRuntimeTools } from '../src/host/tools/index.ts';
import { ToolHostClient } from '../src/client/client.ts';

test('cancel: aborting a long exec stops it promptly with error "aborted"', async () => {
  const { brain, host } = linkedChannels();
  new ToolHostServer(host, defaultRuntimeTools()).start();
  const client = new ToolHostClient(brain);
  await client.ready();

  const controller = new AbortController();
  const started = Date.now();
  const pending = client.invoke('exec', { command: 'sleep 10' }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);

  const result = await pending;
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'aborted');
  assert.ok(elapsed < 5000, `expected prompt cancel, took ${elapsed}ms`);

  await client.close();
});

test('cancel: a pre-aborted signal never starts the tool', async () => {
  const { brain, host } = linkedChannels();
  new ToolHostServer(host, defaultRuntimeTools()).start();
  const client = new ToolHostClient(brain);
  await client.ready();

  const controller = new AbortController();
  controller.abort();
  const result = await client.invoke('exec', { command: 'echo should-not-run' }, { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'aborted');

  await client.close();
});
