import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { RuntimeTool } from '../server.ts';

function asObject(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>;
}

function requireString(o: Record<string, unknown>, key: string, tool: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new Error(`${tool}: \`${key}\` (non-empty string) is required`);
  return v;
}

const pathOnlySchema = {
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false,
};

export const readFileTool: RuntimeTool = {
  name: 'read_file',
  aiDescription: 'Read a UTF-8 text file from the sandbox. Returns content (truncated to maxBytes) and byte size.',
  humanDescription: 'Read a file',
  paramsSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, maxBytes: { type: 'number' } },
    required: ['path'],
    additionalProperties: false,
  },
  async run(raw) {
    const o = asObject(raw);
    const p = requireString(o, 'path', 'read_file');
    const maxBytes = typeof o.maxBytes === 'number' && o.maxBytes > 0 ? o.maxBytes : 1_000_000;
    const buf = await fs.readFile(p);
    return {
      path: p,
      bytes: buf.byteLength,
      truncated: buf.byteLength > maxBytes,
      content: buf.subarray(0, maxBytes).toString('utf8'),
    };
  },
};

export const writeFileTool: RuntimeTool = {
  name: 'write_file',
  aiDescription: 'Write a UTF-8 text file in the sandbox, creating parent directories as needed.',
  humanDescription: 'Write a file',
  paramsSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(raw) {
    const o = asObject(raw);
    const p = requireString(o, 'path', 'write_file');
    const content = typeof o.content === 'string' ? o.content : '';
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
    return { path: p, bytesWritten: Buffer.byteLength(content) };
  },
};

export const listDirTool: RuntimeTool = {
  name: 'list_dir',
  aiDescription: 'List the entries of a directory in the sandbox.',
  humanDescription: 'List a directory',
  paramsSchema: pathOnlySchema,
  async run(raw) {
    const o = asObject(raw);
    const p = requireString(o, 'path', 'list_dir');
    const entries = await fs.readdir(p, { withFileTypes: true });
    return {
      path: p,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file',
      })),
    };
  },
};

export const statTool: RuntimeTool = {
  name: 'stat',
  aiDescription: 'Stat a path in the sandbox (size, kind, mtime).',
  humanDescription: 'Stat a path',
  paramsSchema: pathOnlySchema,
  async run(raw) {
    const o = asObject(raw);
    const p = requireString(o, 'path', 'stat');
    const s = await fs.stat(p);
    return { path: p, size: s.size, isFile: s.isFile(), isDir: s.isDirectory(), mtimeMs: s.mtimeMs };
  },
};
