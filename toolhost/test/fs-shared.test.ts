import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRangeEdit, deadline, fileHash } from '../src/host/tools/fs-shared.ts';

test('applyRangeEdit: insert (length 0) pushes the line down', () => {
  assert.equal(applyRangeEdit('a\nb\nc', 2, 0, 'X'), 'a\nX\nb\nc');
});

test('applyRangeEdit: change a range', () => {
  assert.equal(applyRangeEdit('a\nb\nc\nd', 2, 2, 'X'), 'a\nX\nd');
});

test('applyRangeEdit: delete a range (empty content)', () => {
  assert.equal(applyRangeEdit('a\nb\nc\n', 2, 1, ''), 'a\nc\n');
});

test('applyRangeEdit: offset past EOF appends, length clamps', () => {
  assert.equal(applyRangeEdit('a\nb', 9, 5, 'X'), 'a\nb\nX');
});

test('applyRangeEdit: multi-line content splices verbatim', () => {
  assert.equal(applyRangeEdit('a\nb', 2, 0, 'X\nY'), 'a\nX\nY\nb');
});

test('deadline expires with time and reports not-yet in the future', () => {
  assert.equal(deadline(-1).expired(), true);
  assert.equal(deadline(600_000).expired(), false);
});

test('fileHash is stable and content-sensitive', () => {
  assert.equal(fileHash(Buffer.from('hello')), fileHash(Buffer.from('hello')));
  assert.notEqual(fileHash(Buffer.from('hello')), fileHash(Buffer.from('hellox')));
});
