import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SRC_RELATIVE = 'toolhost/src';

/**
 * Locate the in-repo tool-host source dir (the thing we ship to a remote). Mirrors
 * resolveHostEntry's candidate search; override with RUNVANE_TOOLHOST_SRC_DIR.
 */
export function resolveHostSrcDir(): string | null {
  const explicit = process.env.RUNVANE_TOOLHOST_SRC_DIR?.trim();
  const candidates = [
    explicit,
    path.resolve(process.cwd(), SRC_RELATIVE),
    path.resolve(process.cwd(), '..', SRC_RELATIVE),
    `/workspace/${SRC_RELATIVE}`,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'host', 'main.ts'))) return candidate;
  }
  return null;
}

/**
 * Content hash of the host source (.ts files only, path + bytes). Keys the
 * remote install dir so an unchanged tree reuses the existing copy and a changed
 * one lands in a fresh dir.
 */
export function hashHostSrc(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string, rel: string): void => {
    for (const name of readdirSync(current).sort()) {
      const abs = path.join(current, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        walk(abs, relPath);
      } else if (name.endsWith('.ts')) {
        hash.update(relPath);
        hash.update('\0');
        hash.update(readFileSync(abs));
        hash.update('\0');
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex').slice(0, 16);
}

function spawnOk(command: string, args: string[], stdinFrom?: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [stdinFrom ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? '?'}: ${stderr.trim()}`)),
    );
    if (stdinFrom && child.stdin) stdinFrom.pipe(child.stdin);
  });
}

/**
 * Ship the in-repo tool-host source to an ssh remote and return the command that
 * runs it there. Idempotent: the source is content-hashed into
 * `~/.cache/runvane-toolhost/<hash>` and just re-extracted (cheap) on reconnect.
 * The remote needs only `node` (>=22, for type-stripping), `tar`, and a POSIX
 * shell — no preinstalled tool-host. `sshBaseArgs` is the ssh argv up to and
 * including the destination (flags + user@host), with no remote command yet.
 */
export async function deployToolHostOverSsh(sshBaseArgs: string[]): Promise<string> {
  const srcDir = resolveHostSrcDir();
  if (!srcDir) {
    throw new Error('tool-host source not found to deploy (set RUNVANE_TOOLHOST_SRC_DIR)');
  }
  const remoteDir = `"$HOME/.cache/runvane-toolhost/${hashHostSrc(srcDir)}"`;

  // Pack locally, unpack remotely over the same ssh connection. <hash> is hex,
  // so it needs no shell quoting; $HOME expands on the remote.
  const tar = spawn('tar', ['czf', '-', '-C', srcDir, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let tarErr = '';
  tar.stderr.on('data', (d: Buffer) => (tarErr += d.toString()));
  const tarDone = new Promise<void>((resolve, reject) => {
    tar.on('error', reject);
    tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code ?? '?'}: ${tarErr.trim()}`))));
  });

  await Promise.all([
    spawnOk('ssh', [...sshBaseArgs, `mkdir -p ${remoteDir} && tar xzf - -C ${remoteDir}`], tar.stdout),
    tarDone,
  ]);

  return `exec node --experimental-strip-types ${remoteDir}/host/main.ts`;
}
