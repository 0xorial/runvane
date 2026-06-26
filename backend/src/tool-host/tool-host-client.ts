import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  TOOL_HOST_PROTOCOL_VERSION,
  type HarnessToHost,
  type HostToHarness,
  type HostToolDescriptor,
  type InvocationResult,
} from './protocol.js';

export type ToolHostSpawnConfig = { command: string; args: string[] };

export type ToolHostInvokeOptions = {
  signal?: AbortSignal;
  onProgress?: (delta: string) => void;
  sessionId?: string;
};

type PendingInvocation = {
  resolve: (result: InvocationResult) => void;
  onProgress: ((delta: string) => void) | undefined;
  detachAbort: (() => void) | undefined;
};

type ReadyWaiter = { resolve: () => void; reject: (err: Error) => void };

/**
 * Harness-side client for a tool-host process. Spawns the host, speaks NDJSON
 * over its stdio, correlates invocations by id, streams progress, and forwards
 * AbortSignal aborts as `cancel`. `invoke()` matches runvane's ToolRunContext
 * so a host tool can be exposed as a thin BaseTool proxy.
 */
export class ToolHostClient {
  private readonly logger = new Logger(ToolHostClient.name);
  private readonly config: ToolHostSpawnConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private closed = false;
  private isReady = false;
  private readyWaiters: ReadyWaiter[] = [];
  private readonly pendingInvocations = new Map<string, PendingInvocation>();
  private readonly pendingLists = new Map<string, (tools: HostToolDescriptor[]) => void>();

  constructor(config: ToolHostSpawnConfig) {
    this.config = config;
  }

  start(): void {
    const child = spawn(this.config.command, this.config.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => this.logger.debug(`[toolhost] ${d.trimEnd()}`));
    child.on('error', (err) => this.teardown(err));
    child.on('exit', () => this.teardown());
    this.send({ type: 'hello', protocolVersion: TOOL_HOST_PROTOCOL_VERSION });
  }

  ready(timeoutMs = 5000): Promise<void> {
    if (this.isReady) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error('tool-host channel closed'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tool-host ready timeout')), timeoutMs);
      this.readyWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  listTools(): Promise<HostToolDescriptor[]> {
    if (this.closed) return Promise.resolve([]);
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.pendingLists.set(requestId, resolve);
      this.send({ type: 'list_tools', requestId });
    });
  }

  /** Run a tool on the host. Never throws — failures come back as `ok:false`. */
  invoke(toolName: string, params: unknown, opts: ToolHostInvokeOptions = {}): Promise<InvocationResult> {
    if (this.closed) return Promise.resolve(errorResult('tool-host channel closed'));
    if (opts.signal?.aborted) return Promise.resolve(errorResult('aborted'));

    const invocationId = randomUUID();
    const sessionId = opts.sessionId ?? 'local';
    return new Promise((resolve) => {
      const signal = opts.signal;
      let detachAbort: (() => void) | undefined;
      if (signal) {
        const onAbort = (): void => this.send({ type: 'cancel', invocationId });
        signal.addEventListener('abort', onAbort, { once: true });
        detachAbort = () => signal.removeEventListener('abort', onAbort);
      }
      this.pendingInvocations.set(invocationId, { resolve, onProgress: opts.onProgress, detachAbort });
      this.send({ type: 'invoke', invocationId, sessionId, toolName, params });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child) {
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      child.kill();
    }
  }

  private send(msg: HarnessToHost): void {
    if (this.child && !this.closed) this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) {
        try {
          this.handle(JSON.parse(line) as HostToHarness);
        } catch {
          /* stray non-JSON line on stdout — ignore */
        }
      }
      nl = this.buffer.indexOf('\n');
    }
  }

  private handle(msg: HostToHarness): void {
    switch (msg.type) {
      case 'ready': {
        this.isReady = true;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w.resolve();
        return;
      }
      case 'tools': {
        const resolve = this.pendingLists.get(msg.requestId);
        if (resolve) {
          this.pendingLists.delete(msg.requestId);
          resolve(msg.tools);
        }
        return;
      }
      case 'progress': {
        this.pendingInvocations.get(msg.invocationId)?.onProgress?.(msg.delta);
        return;
      }
      case 'result': {
        const pending = this.pendingInvocations.get(msg.invocationId);
        if (!pending) return;
        this.pendingInvocations.delete(msg.invocationId);
        pending.detachAbort?.();
        pending.resolve({ ok: msg.ok, output: msg.output, error: msg.error, timing: msg.timing });
        return;
      }
      case 'error': {
        if (!msg.invocationId) return;
        const pending = this.pendingInvocations.get(msg.invocationId);
        if (!pending) return;
        this.pendingInvocations.delete(msg.invocationId);
        pending.detachAbort?.();
        pending.resolve(errorResult(msg.message));
        return;
      }
      case 'pong':
        return;
    }
  }

  private teardown(err?: Error): void {
    if (this.closed && this.readyWaiters.length === 0 && this.pendingInvocations.size === 0) return;
    this.closed = true;
    const message = err ? err.message : 'tool-host channel closed';
    for (const pending of this.pendingInvocations.values()) {
      pending.detachAbort?.();
      pending.resolve(errorResult(message));
    }
    this.pendingInvocations.clear();
    for (const resolve of this.pendingLists.values()) resolve([]);
    this.pendingLists.clear();
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(new Error(message));
  }
}

function errorResult(message: string): InvocationResult {
  const now = new Date().toISOString();
  return { ok: false, output: null, error: message, timing: { startedAt: now, finishedAt: now, elapsedMs: 0 } };
}
