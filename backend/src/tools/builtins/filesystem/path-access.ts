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
