import { spawn } from 'node:child_process';
import type { TargetTool } from '../server.ts';

type ExecParams = { command: string; cwd?: string; timeoutMs?: number };

/**
 * Run a shell command in the sandbox. Streams stdout+stderr as progress, kills
 * the process on cancel (AbortSignal) or timeout, and returns the exit code
 * plus captured output.
 */
export const execTool: TargetTool = {
  name: 'exec',
  aiDescription: 'Run a shell command in the sandbox via `bash -lc`. Streams output; returns exit code and captured stdout/stderr.',
  humanDescription: 'Run a shell command',
  paramsSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run via `bash -lc`.' },
      cwd: { type: 'string', description: 'Working directory (default: host cwd).' },
      timeoutMs: { type: 'number', description: 'Kill the command after this many ms.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  parseParams(raw) {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (typeof p.command !== 'string' || p.command.trim() === '') {
      throw new Error('exec: `command` (non-empty string) is required');
    }
    const out: ExecParams = { command: p.command };
    if (typeof p.cwd === 'string') out.cwd = p.cwd;
    if (typeof p.timeoutMs === 'number') out.timeoutMs = p.timeoutMs;
    return out;
  },
  run(params, ctx) {
    const p = params as ExecParams;
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-lc', p.command], { cwd: p.cwd, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        stdout += d;
        ctx.onProgress(d);
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d: string) => {
        stderr += d;
        ctx.onProgress(d);
      });

      const kill = (sig: NodeJS.Signals): void => {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      };
      const onAbort = (): void => {
        kill('SIGTERM');
        setTimeout(() => kill('SIGKILL'), 2000).unref();
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
      };

      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });

      if (p.timeoutMs && p.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          onAbort();
        }, p.timeoutMs);
        timer.unref();
      }

      child.on('error', (err) => {
        cleanup();
        reject(err);
      });
      child.on('close', (code, signal) => {
        cleanup();
        if (ctx.signal.aborted) {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
          return;
        }
        if (timedOut) {
          reject(new Error(`exec: timed out after ${p.timeoutMs}ms`));
          return;
        }
        resolve({ exitCode: code, signal, stdout, stderr });
      });
    });
  },
};
