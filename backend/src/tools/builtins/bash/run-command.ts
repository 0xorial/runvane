import { spawn } from 'node:child_process';

export type BashToolResult = {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsed_ms: number;
};

/**
 * Run `command` via `/bin/bash -c`, streaming output through `onProgress` and
 * capping the combined stdout+stderr at `maxOutputBytes`. When the cap is hit
 * the kept payload gets an inline truncation notice (so the model narrows the
 * command instead of dumping the whole thing into context again) and
 * `truncated` is set.
 */
export function runBashCommand(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  maxOutputBytes: number,
  signal: AbortSignal,
  onProgress?: (delta: string) => void,
): Promise<BashToolResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], { cwd: cwd || undefined, signal });

    // Accumulate raw bytes (decode once at the end so multi-byte chars are not
    // corrupted at chunk boundaries); stream each kept slice live as it arrives.
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let keptBytes = 0; // combined stdout+stderr budget, matching maxOutputBytes
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const absorb = (chunk: Buffer, sink: Buffer[]): void => {
      const remaining = maxOutputBytes - keptBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (chunk.length > remaining) truncated = true;
      sink.push(slice);
      keptBytes += slice.length;
      onProgress?.(slice.toString('utf8'));
    };

    child.stdout?.on('data', (chunk: Buffer) => absorb(chunk, outChunks));
    child.stderr?.on('data', (chunk: Buffer) => absorb(chunk, errChunks));

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Steering / user cancellation → clean AbortError (no planner follow-up).
      if (error.code === 'ABORT_ERR' || error.name === 'AbortError' || signal.aborted) {
        reject(Object.assign(new Error('bash: command aborted'), { name: 'AbortError' }));
        return;
      }
      // Could not spawn the process (bad cwd, missing shell, …).
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const elapsed_ms = Date.now() - start;
      const rawStdout = Buffer.concat(outChunks).toString('utf8');
      let stderr = Buffer.concat(errChunks).toString('utf8');
      // When output was cut, say so inline (not just via the `truncated` flag)
      // so the model narrows the command instead of dumping the whole tree into
      // context again — and the human sees it was clipped.
      const stdout = truncated
        ? `${rawStdout}\n[bash: output truncated to ${maxOutputBytes} bytes — narrow the command (target specific paths, or pipe through head/tail/grep)]`
        : rawStdout;
      if (timedOut) {
        stderr += `${stderr ? '\n' : ''}bash: command timed out after ${timeoutMs}ms`;
        resolve({ command, exit_code: -1, stdout, stderr, truncated, elapsed_ms });
        return;
      }
      // `code` is null when the child was killed by a signal → treat as failure.
      const exit_code = typeof code === 'number' ? code : 1;
      resolve({ command, exit_code, stdout, stderr, truncated, elapsed_ms });
    });
  });
}
