import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnChannel } from '../src/transport/childProcess.ts';
import { ToolHostClient } from '../src/client/client.ts';
import type { BrainToHost, HostToBrain } from '../src/protocol/messages.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

// Mirrors the ssh deploy (ssh-deploy.ts) without the network: tar the host
// source, unpack it into a scratch dir, and run `node host/main.ts` from there.
// Proves a bare environment with only node + tar can serve the tool-host.
test('deploy round-trip: a tar-shipped copy of the source serves the protocol', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toolhost-deploy-'));
  try {
    const packed = spawnSync('sh', [
      '-c',
      `tar czf - -C ${JSON.stringify(srcDir)} . | tar xzf - -C ${JSON.stringify(dir)}`,
    ]);
    assert.equal(packed.status, 0, packed.stderr?.toString());

    const { channel, child } = spawnChannel<HostToBrain, BrainToHost>(process.execPath, [
      '--experimental-strip-types',
      join(dir, 'host', 'main.ts'),
    ]);
    const client = new ToolHostClient(channel);
    await client.ready();

    const tools = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'filesystem'));
    assert.ok(tools.some((t) => t.name === 'exec'));

    const result = await client.invoke('exec', { command: 'echo deployed-ok' });
    assert.equal(result.ok, true, result.error ?? '');
    assert.match((result.output as { stdout: string }).stdout, /deployed-ok/);

    await client.close();
    child.kill();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
