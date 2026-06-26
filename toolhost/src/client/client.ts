import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION } from '../protocol/messages.ts';
import type { HostToHarness, HostToolDescriptor, InvocationResult } from '../protocol/messages.ts';
import type { HarnessChannel } from '../transport/channel.ts';
import type { InvocationReporter } from './reporter.ts';

export type InvokeOptions = {
  signal?: AbortSignal;
  onProgress?: (delta: string) => void;
  sessionId?: string;
};

type Pending = {
  resolve: (result: InvocationResult) => void;
  onProgress: ((delta: string) => void) | undefined;
  detachAbort: (() => void) | undefined;
};

/**
 * Harness-side client for a tool-host. Correlates invocations by id, streams
 * progress to `onProgress`, resolves on `result`, and forwards `AbortSignal`
 * aborts as `cancel`. `invoke()` mirrors runvane's `ToolRunContext` so a host
 * tool can be exposed as a thin BaseTool proxy (see proxy.ts).
 */
export class ToolHostClient {
  private readonly channel: HarnessChannel;
  private readonly reporter: InvocationReporter | undefined;
  private readonly pendingInvocations = new Map<string, Pending>();
  private readonly pendingToolLists = new Map<string, (tools: HostToolDescriptor[]) => void>();
  private readonly pendingPings = new Map<string, () => void>();
  private readyResolvers: Array<() => void> = [];
  private isReady = false;
  private closed = false;
  private closeError: Error | null = null;

  constructor(channel: HarnessChannel, reporter?: InvocationReporter) {
    this.channel = channel;
    this.reporter = reporter;
    this.channel.onMessage((msg) => this.handle(msg));
    this.channel.onClose((err) => this.onClose(err));
    this.channel.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
  }

  /** Resolves once the host has sent `ready` (or rejects if the channel died). */
  ready(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    if (this.closed) return Promise.reject(this.closeError ?? new Error('tool-host channel closed'));
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  listTools(): Promise<HostToolDescriptor[]> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error('tool-host channel closed'));
    const requestId = randomUUID();
    return new Promise<HostToolDescriptor[]>((resolve) => {
      this.pendingToolLists.set(requestId, resolve);
      this.channel.send({ type: 'list_tools', requestId });
    });
  }

  /** Run a tool on the host. Never throws — failures come back as `ok:false`. */
  invoke(toolName: string, params: unknown, opts: InvokeOptions = {}): Promise<InvocationResult> {
    if (this.closed) return Promise.resolve(this.errorResult('tool-host channel closed'));
    if (opts.signal?.aborted) return Promise.resolve(this.errorResult('aborted'));

    const invocationId = randomUUID();
    const sessionId = opts.sessionId ?? 'local';

    return new Promise<InvocationResult>((resolve) => {
      const signal = opts.signal;
      let detachAbort: (() => void) | undefined;
      if (signal) {
        const onAbort = (): void => this.channel.send({ type: 'cancel', invocationId });
        signal.addEventListener('abort', onAbort, { once: true });
        detachAbort = () => signal.removeEventListener('abort', onAbort);
      }
      this.pendingInvocations.set(invocationId, { resolve, onProgress: opts.onProgress, detachAbort });
      this.reporter?.onInvocationStart({ invocationId, toolName, sessionId });
      this.channel.send({ type: 'invoke', invocationId, sessionId, toolName, params });
    });
  }

  /** Round-trip ping; resolves with elapsed milliseconds. */
  ping(): Promise<number> {
    if (this.closed) return Promise.reject(this.closeError ?? new Error('tool-host channel closed'));
    const nonce = randomUUID();
    const start = Date.now();
    return new Promise<number>((resolve) => {
      this.pendingPings.set(nonce, () => resolve(Date.now() - start));
      this.channel.send({ type: 'ping', nonce });
    });
  }

  close(): Promise<void> {
    return this.channel.close();
  }

  private handle(msg: HostToHarness): void {
    switch (msg.type) {
      case 'ready': {
        this.isReady = true;
        const resolvers = this.readyResolvers;
        this.readyResolvers = [];
        for (const r of resolvers) r();
        return;
      }
      case 'tools': {
        const resolve = this.pendingToolLists.get(msg.requestId);
        if (resolve) {
          this.pendingToolLists.delete(msg.requestId);
          resolve(msg.tools);
        }
        return;
      }
      case 'progress': {
        this.pendingInvocations.get(msg.invocationId)?.onProgress?.(msg.delta);
        this.reporter?.onInvocationProgress({ invocationId: msg.invocationId, delta: msg.delta });
        return;
      }
      case 'result': {
        const pending = this.pendingInvocations.get(msg.invocationId);
        if (!pending) return;
        this.pendingInvocations.delete(msg.invocationId);
        pending.detachAbort?.();
        const result: InvocationResult = { ok: msg.ok, output: msg.output, error: msg.error, timing: msg.timing };
        this.reporter?.onInvocationEnd({ invocationId: msg.invocationId, result });
        pending.resolve(result);
        return;
      }
      case 'pong': {
        const resolve = this.pendingPings.get(msg.nonce);
        if (resolve) {
          this.pendingPings.delete(msg.nonce);
          resolve();
        }
        return;
      }
      case 'error': {
        if (!msg.invocationId) return;
        const pending = this.pendingInvocations.get(msg.invocationId);
        if (!pending) return;
        this.pendingInvocations.delete(msg.invocationId);
        pending.detachAbort?.();
        const result = this.errorResult(msg.message);
        this.reporter?.onInvocationEnd({ invocationId: msg.invocationId, result });
        pending.resolve(result);
        return;
      }
    }
  }

  private onClose(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = err ?? null;
    const message = err ? err.message : 'tool-host channel closed';

    for (const pending of this.pendingInvocations.values()) {
      pending.detachAbort?.();
      pending.resolve(this.errorResult(message));
    }
    this.pendingInvocations.clear();
    for (const resolve of this.pendingToolLists.values()) resolve([]);
    this.pendingToolLists.clear();
    this.pendingPings.clear();
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const r of resolvers) r();
  }

  private errorResult(message: string): InvocationResult {
    const now = new Date().toISOString();
    return { ok: false, output: null, error: message, timing: { startedAt: now, finishedAt: now, elapsedMs: 0 } };
  }
}
