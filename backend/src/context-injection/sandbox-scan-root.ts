import type { ToolSandbox } from '../contracts/tool-sandbox.js';
import type { PreinjectScanUnavailableReason } from '../contracts/preinject.js';

export type SandboxScanRoot =
  | { root: string; reason?: undefined }
  | { root: null; reason: PreinjectScanUnavailableReason };

/**
 * Where context-file discovery runs for a given tool sandbox — the workspace
 * the agent's tools actually operate in, NOT unconditionally the app's cwd:
 *
 * - `local` (harness host): tools share the server's filesystem, so the
 *   server's cwd is the workspace (same root the filesystem tool defaults
 *   its `allowed_roots` to).
 * - `ssh`: the workspace lives on the remote host; scanning it would have to
 *   go through the tool-host transport, which isn't wired yet — no scan,
 *   surfaced as `remote-sandbox` rather than silently scanning the wrong
 *   machine.
 * - `none`: target tools are disabled; there is no workspace to describe.
 */
export function resolveSandboxScanRoot(sandbox: ToolSandbox): SandboxScanRoot {
  if (sandbox.kind === 'local') return { root: process.cwd() };
  if (sandbox.kind === 'ssh') return { root: null, reason: 'remote-sandbox' };
  return { root: null, reason: 'no-sandbox' };
}
