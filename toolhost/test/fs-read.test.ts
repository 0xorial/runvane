import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { filesystemReadTool } from '../src/host/tools/fs-read.ts';
import type { TargetToolContext } from '../src/host/server.ts';

function ctx(): TargetToolContext {
  return { sessionId: 's', invocationId: 'i', signal: new AbortController().signal, onProgress: () => {}, log: () => {} };
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rv-fsr-'));
  await writeFile(path.join(dir, 'a.txt'), 'alpha\nbravo\ncharlie\ndelta\n', 'utf8');
  await mkdir(path.join(dir, 'sub'));
  await writeFile(path.join(dir, 'sub', 'b.txt'), 'bravo here too\n', 'utf8');
  await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  return dir;
}

function run(params: Record<string, unknown>) {
  return filesystemReadTool.run(params, ctx()) as Promise<Record<string, unknown>>;
}

test('read returns utf8 content and a stable hash', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read', path: path.join(dir, 'a.txt'), allowed_roots: [dir] });
  assert.equal(out.encoding, 'utf8');
  assert.equal(out.content, 'alpha\nbravo\ncharlie\ndelta\n');
  assert.equal(typeof out.hash, 'string');
  assert.equal((out.hash as string).length, 16);
});

test('read supports ranged reads with line accounting', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read', path: path.join(dir, 'a.txt'), offset: 2, limit: 2, allowed_roots: [dir] });
  assert.equal(out.content, 'bravo\ncharlie');
  assert.equal(out.startLine, 2);
  assert.equal(out.endLine, 3);
  assert.equal(out.totalLines, 5);
});

test('read auto-returns base64 for a binary file', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read', path: path.join(dir, 'bin.dat'), allowed_roots: [dir] });
  assert.equal(out.encoding, 'base64');
  assert.equal(Buffer.from(out.content as string, 'base64').toString('hex'), '000102ff');
});

test('read rejects paths outside allowed roots', async () => {
  const dir = await fixture();
  await assert.rejects(run({ operation: 'read', path: '/etc/passwd', allowed_roots: [dir] }), /outside allowed roots/);
});

test('read clamps to max_read_bytes and reports the cap', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read', path: path.join(dir, 'a.txt'), max_read_bytes: 5, allowed_roots: [dir] });
  assert.equal(out.truncated, true);
  assert.equal(out.cap, 'max_read_bytes');
  assert.equal(out.content, 'alpha');
});

test('list returns entries with kinds', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'list', path: dir, allowed_roots: [dir] });
  const entries = out.entries as Array<{ name: string; kind: string }>;
  assert.deepEqual(entries.map((e) => `${e.name}:${e.kind}`).sort(), ['a.txt:file', 'bin.dat:file', 'sub:directory']);
});

test('grep finds matches under a path, returning absolute paths', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'grep', pattern: 'bravo', path: dir, allowed_roots: [dir] });
  assert.equal(out.count, 2);
  const hits = out.hits as Array<{ file: string }>;
  assert.ok(hits.every((h) => path.isAbsolute(h.file)));
});

test('grep with no path searches all allowed roots (global)', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'grep', pattern: 'charlie', allowed_roots: [dir] });
  assert.equal(out.count, 1);
});

test('grep supports regex and reports max_grep_results cap', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'grep', pattern: 'a', path: dir, max_grep_results: 1, allowed_roots: [dir] });
  assert.equal((out.hits as unknown[]).length, 1);
  assert.equal(out.cap, 'max_grep_results');
});

test('find matches file names by substring and glob, globally', async () => {
  const dir = await fixture();
  const bySubstr = await run({ operation: 'find', pattern: 'b.txt', allowed_roots: [dir] });
  assert.equal(bySubstr.count, 1);
  const byGlob = await run({ operation: 'find', pattern: '*.txt', allowed_roots: [dir] });
  assert.equal(byGlob.count, 2);
});

test('stat reports kind, size, line count, and a hash', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'stat', path: path.join(dir, 'a.txt'), allowed_roots: [dir] });
  assert.equal(out.kind, 'file');
  assert.equal(out.lineCount, 4);
  assert.equal(typeof out.hash, 'string');
});
