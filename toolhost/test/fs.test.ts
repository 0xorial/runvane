import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { filesystemTool, unifiedDiff } from '../src/host/tools/fs.ts';
import type { TargetToolContext } from '../src/host/server.ts';

function ctx(): TargetToolContext {
  return {
    sessionId: 's',
    invocationId: 'i',
    signal: new AbortController().signal,
    onProgress: () => {},
    log: () => {},
  };
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rv-fs-'));
  await writeFile(path.join(dir, 'a.txt'), 'alpha\nbravo\ncharlie\ndelta\n', 'utf8');
  await mkdir(path.join(dir, 'sub'));
  await writeFile(path.join(dir, 'sub', 'b.txt'), 'bravo here too\n', 'utf8');
  return dir;
}

function run(params: Record<string, unknown>) {
  return filesystemTool.run(params, ctx()) as Promise<Record<string, unknown>>;
}

test('read_file returns contents within allowed roots', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read_file', path: path.join(dir, 'a.txt'), allowed_roots: [dir] });
  assert.equal(out.operation, 'read_file');
  assert.equal(out.content, 'alpha\nbravo\ncharlie\ndelta\n');
  assert.equal(out.truncated, false);
});

test('read_file supports ranged reads with line accounting', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'read_file', path: path.join(dir, 'a.txt'), offset: 2, limit: 2, allowed_roots: [dir] });
  assert.equal(out.content, 'bravo\ncharlie');
  assert.equal(out.startLine, 2);
  assert.equal(out.endLine, 3);
  assert.equal(out.totalLines, 5);
});

test('read_file rejects paths outside allowed roots (incl. .. traversal)', async () => {
  const dir = await fixture();
  const outside = path.join(dir, '..', path.basename(dir) === 'x' ? 'y' : `${path.basename(dir)}-outside.txt`);
  await writeFile(path.resolve(outside), 'secret', 'utf8');
  await assert.rejects(
    run({ operation: 'read_file', path: path.join(dir, 'sub', '..', '..', path.basename(path.resolve(outside))), allowed_roots: [dir] }),
    /outside allowed roots/,
  );
});

test('read_file refuses symlink escapes from an allowed root', async () => {
  const dir = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'rv-fs-outside-'));
  await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  await symlink(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
  await assert.rejects(
    run({ operation: 'read_file', path: path.join(dir, 'link.txt'), allowed_roots: [dir] }),
    /outside allowed roots/,
  );
});

test('list_dir lists entries with kinds', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'list_dir', path: dir, allowed_roots: [dir] });
  const entries = out.entries as Array<{ name: string; kind: string }>;
  assert.deepEqual(
    entries.map((e) => `${e.name}:${e.kind}`).sort(),
    ['a.txt:file', 'sub:directory'],
  );
});

test('grep finds matching lines across a directory', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'grep', path: dir, pattern: 'bravo', allowed_roots: [dir] });
  const hits = out.hits as Array<{ file: string; line: number; text: string }>;
  assert.equal(out.count, 2);
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}`).sort(),
    ['a.txt:2', `sub${path.sep}b.txt:1`],
  );
});

test('grep supports regex and context lines', async () => {
  const dir = await fixture();
  const out = await run({
    operation: 'grep',
    path: path.join(dir, 'a.txt'),
    pattern: '^ch.rlie$',
    is_regex: true,
    context_lines: 1,
    allowed_roots: [dir],
  });
  const hits = out.hits as Array<{ line: number; before?: string[]; after?: string[] }>;
  assert.equal(out.count, 1);
  const first = hits[0]!;
  assert.equal(first.line, 3);
  assert.deepEqual(first.before, ['bravo']);
  assert.deepEqual(first.after, ['delta']);
});

test('stat reports kind, size, and line count for text files', async () => {
  const dir = await fixture();
  const out = await run({ operation: 'stat', path: path.join(dir, 'a.txt'), allowed_roots: [dir] });
  assert.equal(out.kind, 'file');
  assert.equal(out.lineCount, 4);
});

test('write_file fails closed without writable_roots', async () => {
  const dir = await fixture();
  await assert.rejects(
    run({ operation: 'write_file', path: path.join(dir, 'new.txt'), content: 'x', allowed_roots: [dir] }),
    /writes are disabled/,
  );
});

test('write_file writes inside a writable root, creating parents', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'deep', 'new.txt');
  const out = await run({
    operation: 'write_file',
    path: target,
    content: 'written',
    allowed_roots: [dir],
    writable_roots: [dir],
  });
  assert.equal(out.created, true);
  assert.equal(await readFile(target, 'utf8'), 'written');
});

test('write_file rejects targets outside writable roots', async () => {
  const dir = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'rv-fs-outside-'));
  await assert.rejects(
    run({ operation: 'write_file', path: path.join(outside, 'x.txt'), content: 'x', writable_roots: [dir] }),
    /outside writable roots/,
  );
});

test('edit_file replaces a unique string and returns a diff', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'a.txt');
  const out = await run({
    operation: 'edit_file',
    path: target,
    old_string: 'charlie',
    new_string: 'carol',
    writable_roots: [dir],
  });
  assert.equal(out.replacements, 1);
  assert.match(String(out.diff), /-charlie/);
  assert.match(String(out.diff), /\+carol/);
  assert.match(await readFile(target, 'utf8'), /carol/);
});

test('edit_file demands uniqueness unless replace_all', async () => {
  const dir = await fixture();
  const target = path.join(dir, 'dup.txt');
  await writeFile(target, 'x\nx\n', 'utf8');
  await assert.rejects(
    run({ operation: 'edit_file', path: target, old_string: 'x', new_string: 'y', writable_roots: [dir] }),
    /appears 2 times/,
  );
  const out = await run({
    operation: 'edit_file',
    path: target,
    old_string: 'x',
    new_string: 'y',
    replace_all: true,
    writable_roots: [dir],
  });
  assert.equal(out.replacements, 2);
  assert.equal(await readFile(target, 'utf8'), 'y\ny\n');
});

test('read caps clamp the model max_bytes to the governed cap', async () => {
  const dir = await fixture();
  const out = await run({
    operation: 'read_file',
    path: path.join(dir, 'a.txt'),
    max_bytes: 999_999,
    max_read_bytes: 5,
    allowed_roots: [dir],
  });
  assert.equal(out.truncated, true);
  assert.equal(out.content, 'alpha');
});

test('unifiedDiff emits one hunk with context', () => {
  const diff = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', 'f.txt');
  assert.match(diff, /--- f\.txt/);
  assert.match(diff, /-b/);
  assert.match(diff, /\+B/);
});
