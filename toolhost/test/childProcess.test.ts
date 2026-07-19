import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnChannel } from '../src/transport/childProcess.ts';
import { ToolHostClient } from '../src/client/client.ts';
import type { HarnessToHost, HostToHarness } from '../src/protocol/messages.ts';

const here = dirname(fileURLToPath(import.meta.url));
const hostMain = join(here, '..', 'src', 'host', 'main.ts');

test('child process: write then read a file back over stdio', async () => {
  const { channel, child } = spawnChannel<HostToHarness, HarnessToHost>(process.execPath, [hostMain]);
  const client = new ToolHostClient(channel);
  await client.ready();

  const dir = await mkdtemp(join(tmpdir(), 'toolhost-'));
  try {
    const file = join(dir, 'note.txt');

    // Governance params ride along exactly as the harness rules profile
    // injects them; without a writable root, writes fail closed.
    const written = await client.invoke('filesystem', {
      operation: 'write_file',
      path: file,
      content: 'roundtrip ok',
      writable_roots: [dir],
    });
    assert.equal(written.ok, true, written.error ?? '');

    const read = await client.invoke('filesystem', { operation: 'read_file', path: file, allowed_roots: [dir] });
    assert.equal(read.ok, true, read.error ?? '');
    assert.equal((read.output as { content: string }).content, 'roundtrip ok');
  } finally {
    await client.close();
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test('child process: a dead host fails outstanding invocations instead of hanging', async () => {
  const { channel, child } = spawnChannel<HostToHarness, HarnessToHost>(process.execPath, [hostMain]);
  const client = new ToolHostClient(channel);
  await client.ready();

  // Kill the host mid-flight; the long sleep should settle as a failure.
  const pending = client.invoke('exec', { command: 'sleep 30' });
  setTimeout(() => child.kill('SIGKILL'), 100);
  const result = await pending;
  assert.equal(result.ok, false);

  await client.close();
});
