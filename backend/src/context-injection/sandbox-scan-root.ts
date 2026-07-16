import type { ToolSandbox } from '../contracts/tool-sandbox.js';
import type { PreinjectScanUnavailableReason } from '../contracts/preinject.js';

/** One scannable root of a sandbox workspace: read from `hostPath` on the
 *  harness, presented under `containerPrefix` — the path the AGENT sees
 *  ('' for the local sandbox, where both views are the same). */
export type SandboxScanRoot = {
  hostPath: string;
  containerPrefix: string;
};

export type SandboxScanRoots =
  | { roots: SandboxScanRoot[]; reason?: undefined }
  | { roots: null; reason: PreinjectScanUnavailableReason };

/**
 * Where context-file discovery runs for a tool sandbox — the workspace the
 * agent's tools actually operate in, NOT unconditionally the app's cwd:
 *
 * - `local` (harness host): tools share the server's filesystem, so the
 *   server's cwd is the workspace (same root the filesystem tool defaults
 *   its `allowed_roots` to).
 * - docker sandboxes: each harness-host MOUNT is scannable — read locally
 *   from its host path, presented at its container path (what the agent's
 *   tools see). A mountless sandbox only has container-internal files the
 *   scanner can't reach → `no-mounts`.
 * - plain `ssh`: the workspace lives on the remote host; scanning it would
 *   have to go through the tool-host transport, which isn't wired yet — no
 *   scan, surfaced as `remote-sandbox` rather than silently scanning the
 *   wrong machine.
 * - `none`: target tools are disabled; there is no workspace to describe.
 */
export function resolveSandboxScanRoots(sandbox: ToolSandbox): SandboxScanRoots {
  if (sandbox.kind === 'local') return { roots: [{ hostPath: process.cwd(), containerPrefix: '' }] };
  if (sandbox.docker) {
    if (sandbox.docker.mounts.length === 0) return { roots: null, reason: 'no-mounts' };
    return {
      roots: sandbox.docker.mounts.map((m) => ({ hostPath: m.host, containerPrefix: m.container })),
    };
  }
  if (sandbox.kind === 'ssh') return { roots: null, reason: 'remote-sandbox' };
  return { roots: null, reason: 'no-sandbox' };
}
