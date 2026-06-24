import type { InvocationResult } from '../protocol/messages.ts';

/**
 * A lower-level hook for feeding tool runs into a monitor directly from the
 * client, independent of the brain's `taskRegistry.run(...)` wrapping. Useful
 * when a caller wants invocation lifecycle without routing through a BaseTool.
 */
export interface InvocationReporter {
  onInvocationStart(info: { invocationId: string; toolName: string; sessionId: string }): void;
  onInvocationProgress(info: { invocationId: string; delta: string }): void;
  onInvocationEnd(info: { invocationId: string; result: InvocationResult }): void;
}
