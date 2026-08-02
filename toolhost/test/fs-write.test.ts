import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { filesystemReadTool } from '../src/host/tools/fs-read.ts';
import { filesystemWriteTool } from '../src/host/tools/fs-write.ts';
import type { TargetToolContext } from '../src/host/server.ts';

function ctx(): TargetToolContext {
  return { sessionId: 's', invocationId: 'i', signal: new AbortController().signal, onProgress: () => {}, log: () => {} };
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rv-fsw-'));
  await writeFile(path.join(dir, 'a.txt'), 'alpha\nbravo\ncharlie\ndelta\n', 'utf8');
  return dir;
}

function write(params: Record<string, unknown>) {
  return filesystemWriteTool.run(params, ctx()) as Promise<Record<string, unknown>>;
}

/** Get the current hash the way the model would — through filesystem_read. */
async function readHash(dir: string, file: string): Promise<string> {
  const out = (await filesystemReadTool.run({ operation: 'read', path: file, allowed_roots: [dir] }, ctx())) as { hash: string };
  return out.hash;
}

test('write creates a new file inside a writable root, returning its hash', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'deep', 'new.txt');
  const out = await write({ operation: 'write', path: target, content: 'written', writable_roots: [dir] });
  assert.equal(out.created, true);
  assert.equal(typeof out.hash, 'string');
  assert.equal(await readFile(target, 'utf8'), 'written');
});

test('write fails closed without a writable root', async () => {
  const dir = await fixture();
  await assert.rejects(write({ operation: 'write', path: path.join(dir, 'x.txt'), content: 'x' }), /writes are disabled/);
});

test('write refuses to overwrite an existing file without file_hash', async () => {
  const dir = await fixture();
  await assert.rejects(
    write({ operation: 'write', path: path.join(dir, 'a.txt'), content: 'x', writable_roots: [dir] }),
    /file_hash/,
  );
});

test('hash round-trip: read → write succeeds; an out-of-band change is then rejected', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'a.txt');
  const hash = await readHash(dir, target);

  // With the fresh hash the overwrite is accepted.
  const ok = await write({ operation: 'write', path: target, content: 'v2\n', file_hash: hash, writable_roots: [dir] });
  assert.equal(await readFile(target, 'utf8'), 'v2\n');

  // Someone else mutates the file. The hash we still hold is now stale...
  await writeFile(target, 'v3-parallel\n', 'utf8');
  // ...so a write carrying the OLD hash is refused rather than clobbering v3.
  await assert.rejects(
    write({ operation: 'write', path: target, content: 'v4\n', file_hash: ok.hash, writable_roots: [dir] }),
    /changed since read/,
  );
  assert.equal(await readFile(target, 'utf8'), 'v3-parallel\n');
});

test('replace swaps a unique literal and returns a diff', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'a.txt');
  const out = await write({
    operation: 'replace',
    path: target,
    old_string: 'charlie',
    new_string: 'carol',
    file_hash: await readHash(dir, target),
    writable_roots: [dir],
  });
  assert.equal(out.replacements, 1);
  assert.match(await readFile(target, 'utf8'), /carol/);
});

test('replace supports regex with backrefs', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'a.txt');
  await write({
    operation: 'replace',
    path: target,
    old_string: '(\\w)ravo',
    new_string: '$1RAVO',
    is_regex: true,
    file_hash: await readHash(dir, target),
    writable_roots: [dir],
  });
  assert.match(await readFile(target, 'utf8'), /bRAVO/);
});

test('replace requires file_hash', async () => {
  const dir = await fixture();
  await assert.rejects(
    write({ operation: 'replace', path: path.join(dir, 'a.txt'), old_string: 'alpha', new_string: 'x', writable_roots: [dir] }),
    /requires `file_hash`/,
  );
});

test('edit inserts, changes, and deletes line ranges', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'a.txt');
  // insert a line before line 2
  await write({ operation: 'edit', path: target, offset: 2, length: 0, content: 'INSERTED', file_hash: await readHash(dir, target), writable_roots: [dir] });
  assert.equal(await readFile(target, 'utf8'), 'alpha\nINSERTED\nbravo\ncharlie\ndelta\n');
  // delete that inserted line again
  await write({ operation: 'edit', path: target, offset: 2, length: 1, content: '', file_hash: await readHash(dir, target), writable_roots: [dir] });
  assert.equal(await readFile(target, 'utf8'), 'alpha\nbravo\ncharlie\ndelta\n');
});

test('edit requires file_hash', async () => {
  const dir = await fixture();
  await assert.rejects(
    write({ operation: 'edit', path: path.join(dir, 'a.txt'), offset: 1, content: 'x', writable_roots: [dir] }),
    /requires `file_hash`/,
  );
});

test('mkdir, move, and delete manipulate the tree', async () => {
  const dir = await fixture();
  const madeDir = path.join(dir, 'nested');
  await write({ operation: 'mkdir', path: madeDir, writable_roots: [dir] });
  assert.equal((await stat(madeDir)).isDirectory(), true);

  const moved = path.join(madeDir, 'a-moved.txt');
  await write({ operation: 'move', path: path.join(dir, 'a.txt'), to: moved, writable_roots: [dir] });
  assert.equal((await stat(moved)).isFile(), true);

  await write({ operation: 'delete', path: moved, writable_roots: [dir] });
  await assert.rejects(stat(moved));
});

test('write rejects content over max_write_bytes with a quota hint', async () => {
  const dir = await fixture();
  await assert.rejects(
    write({ operation: 'write', path: path.join(dir, 'big.txt'), content: 'x'.repeat(20), max_write_bytes: 5, writable_roots: [dir] }),
    /max_write_bytes/,
  );
});
