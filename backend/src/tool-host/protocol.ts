/**
 * Wire messages for the runvane tool-host, mirroring the in-repo toolhost/
 * package. The harness (this backend) speaks these as NDJSON
 * over a child process's stdio. Kept in-tree because the package ships as TS
 * source (run via Node type-stripping) and isn't imported into the Nest build;
 * the backend spawns it as a host process instead.
 */
export const TOOL_HOST_PROTOCOL_VERSION = 1;

export type HostToolDescriptor = {
  name: string;
  location: 'target';
  aiDescription: string;
  humanDescription: string;
  paramsSchema: unknown;
};

export type InvocationResult = {
  ok: boolean;
  output: unknown;
  error: string | null;
  timing: { startedAt: string; finishedAt: string; elapsedMs: number };
};

export type HarnessToHost =
  | { type: 'hello'; protocolVersion: number }
  | { type: 'list_tools'; requestId: string }
  | { type: 'invoke'; invocationId: string; sessionId: string; toolName: string; params: unknown }
  | { type: 'cancel'; invocationId: string }
  | { type: 'ping'; nonce: string };

export type HostToHarness =
  | { type: 'ready'; protocolVersion: number }
  | { type: 'tools'; requestId: string; tools: HostToolDescriptor[] }
  | { type: 'progress'; invocationId: string; delta: string }
  | ({ type: 'result'; invocationId: string } & InvocationResult)
  | { type: 'pong'; nonce: string }
  | { type: 'error'; invocationId: string | null; message: string };
