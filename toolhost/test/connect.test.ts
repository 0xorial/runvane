import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectToolHost } from '../src/connect.ts';

test('connectToolHost in-process: ready client that runs a tool', async () => {
  const h = await connectToolHost({ mode: 'in-process' });
  const tools = await h.client.listTools();
  assert.ok(tools.some((t) => t.name === 'exec'));

  const r = await h.client.invoke('exec', { command: 'echo factory' });
  assert.equal(r.ok, true, r.error ?? '');
  assert.match((r.output as { stdout: string }).stdout, /factory/);

  await h.close();
});

test('connectToolHost child: spawns the default host entry and runs a tool', async () => {
  const h = await connectToolHost({ mode: 'child' });
  assert.ok(h.child);

  const r = await h.client.invoke('exec', { command: 'echo child-factory' });
  assert.equal(r.ok, true, r.error ?? '');
  assert.match((r.output as { stdout: string }).stdout, /child-factory/);

  await h.close();
});
