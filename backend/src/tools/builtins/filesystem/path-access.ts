import { realpath } from 'node:fs/promises';
import path from 'node:path';

async function canonicalRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

function isUnderRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function resolveAllowedPath(requested: string, allowedRoots: string[]): Promise<string> {
  const trimmed = requested.trim();
  if (!trimmed) throw new Error('filesystem: path is required');
  if (allowedRoots.length === 0) {
    throw new Error('filesystem: no allowed_roots configured for this agent');
  }

  const target = await realpath(path.resolve(trimmed));
  for (const root of allowedRoots) {
    const rootPath = await canonicalRoot(root);
    if (isUnderRoot(target, rootPath)) return target;
  }
  throw new Error(`filesystem: path ${trimmed} is outside allowed roots`);
}

/**
 * Resolve a WRITE target against writable roots. Unlike the read path, the file
 * may not exist yet, so we canonicalize the deepest existing ancestor (defeats
 * `..` and symlink escapes) and re-append the not-yet-existing tail. Empty
 * writableRoots fails closed — writes are disabled unless a root is configured.
 */
export async function resolveWritablePath(requested: string, writableRoots: string[]): Promise<string> {
  const trimmed = requested.trim();
  if (!trimmed) throw new Error('filesystem: path is required');
  if (writableRoots.length === 0) {
    throw new Error('filesystem: writes are disabled — no writable_roots configured for this agent');
  }

  const resolved = path.resolve(trimmed);
  // Canonicalize as much of the path as exists, then re-attach the missing tail.
  let existing = resolved;
  const tail: string[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const canon = await realpath(existing).catch(() => null);
    if (canon) {
      const target = tail.length ? path.join(canon, ...tail) : canon;
      for (const root of writableRoots) {
        const rootPath = await canonicalRoot(root);
        if (isUnderRoot(target, rootPath)) return target;
      }
      throw new Error(`filesystem: path ${trimmed} is outside writable roots`);
    }
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached filesystem root without resolving
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  throw new Error(`filesystem: cannot resolve write path ${trimmed}`);
}
