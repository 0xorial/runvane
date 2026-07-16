import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/** One directory level on the harness host — the mount picker's data. */
export type HostBrowseResult = {
  /** Normalized absolute path that was listed. */
  path: string;
  /** null at the filesystem root. */
  parent: string | null;
  dirs: Array<{ name: string; path: string }>;
  /** Set when the directory could not be read (missing, not a dir, EACCES);
   *  `dirs` is then empty so the picker can show the message in place. */
  error?: string;
};

/**
 * List the sub-DIRECTORIES of one host path for the sandbox mount picker.
 * Directories only on purpose: mounts source folders, and a flat dir listing
 * keeps the picker focused. Dot-dirs sort after regular ones.
 */
export async function browseHostDirectory(requested: string | undefined): Promise<HostBrowseResult> {
  const target = path.normalize(requested?.trim() || process.cwd());
  if (!path.isAbsolute(target)) {
    return { path: target, parent: null, dirs: [], error: 'path must be absolute' };
  }
  const parent = path.dirname(target);
  const base = { path: target, parent: parent === target ? null : parent };

  try {
    const entries = await readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => {
        const aDot = a.name.startsWith('.');
        const bDot = b.name.startsWith('.');
        if (aDot !== bDot) return aDot ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    return { ...base, dirs };
  } catch (err) {
    return { ...base, dirs: [], error: (err as Error).message };
  }
}
