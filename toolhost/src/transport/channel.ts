import type { BrainToHost, HostToBrain } from '../protocol/messages.ts';

/**
 * A duplex channel that carries framed messages in both directions. Every
 * transport (in-process, child stdio, ssh) reduces to this — the host server
 * and the brain client are written against it and never against a wire.
 */

export type MessageHandler<TIn> = (msg: TIn) => void;
export type CloseHandler = (err?: Error) => void;

export interface MessageChannel<TIn, TOut> {
  send(msg: TOut): void;
  /** Register the inbound handler. Messages received before this is set are queued. */
  onMessage(handler: MessageHandler<TIn>): void;
  /** Register a teardown handler (remote gone, stream ended, error). */
  onClose(handler: CloseHandler): void;
  close(): Promise<void>;
}

/** The brain sends BrainToHost, receives HostToBrain. */
export type BrainChannel = MessageChannel<HostToBrain, BrainToHost>;
/** The host sends HostToBrain, receives BrainToHost. */
export type HostChannel = MessageChannel<BrainToHost, HostToBrain>;
