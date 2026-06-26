import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TargetTool } from '../server.ts';

type FsOperation = 'read_file' | 'write_file' | 'list_dir' | 'stat';
const OPERATIONS: FsOperation[] = ['read_file', 'write_file', 'list_dir', 'stat'];

function asObject(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>;
}

function requireString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new Error(`filesystem: \`${key}\` (non-empty string) is required`);
  return v;
}

/**
 * A single filesystem tool, dispatched on `operation` — mirrors runvane's
 * `filesystem` builtin instead of fanning out one tool per syscall.
 */
export const filesystemTool: TargetTool = {
  name: 'filesystem',
  aiDescription:
    'Filesystem access in the sandbox, selected by `operation`: ' +
    '`read_file` (UTF-8 contents, truncated to maxBytes), ' +
    '`write_file` (writes `content`, creating parent dirs), ' +
    '`list_dir` (directory entries), `stat` (size/kind/mtime). `path` is always required.',
  humanDescription: 'Read, write, list, or stat a sandbox path',
  paramsSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: OPERATIONS },
      path: { type: 'string' },
      content: { type: 'string', description: 'write_file: contents to write.' },
      maxBytes: { type: 'number', description: 'read_file: cap on returned bytes.' },
    },
    required: ['operation', 'path'],
    additionalProperties: false,
  },
  async run(raw) {
    const o = asObject(raw);
    const operation = requireString(o, 'operation') as FsOperation;
    const p = requireString(o, 'path');

    switch (operation) {
      case 'read_file': {
        const maxBytes = typeof o.maxBytes === 'number' && o.maxBytes > 0 ? o.maxBytes : 1_000_000;
        const buf = await fs.readFile(p);
        return {
          operation,
          path: p,
          bytes: buf.byteLength,
          truncated: buf.byteLength > maxBytes,
          content: buf.subarray(0, maxBytes).toString('utf8'),
        };
      }
      case 'write_file': {
        const content = typeof o.content === 'string' ? o.content : '';
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, content, 'utf8');
        return { operation, path: p, bytesWritten: Buffer.byteLength(content) };
      }
      case 'list_dir': {
        const entries = await fs.readdir(p, { withFileTypes: true });
        return {
          operation,
          path: p,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file',
          })),
        };
      }
      case 'stat': {
        const s = await fs.stat(p);
        return { operation, path: p, size: s.size, isFile: s.isFile(), isDir: s.isDirectory(), mtimeMs: s.mtimeMs };
      }
      default:
        throw new Error(`filesystem: unknown operation '${String(operation)}' (expected ${OPERATIONS.join(', ')})`);
    }
  },
};
