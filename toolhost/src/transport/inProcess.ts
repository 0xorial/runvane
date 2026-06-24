import type { BrainToHost, HostToBrain } from '../protocol/messages.ts';
import type { BrainChannel, CloseHandler, HostChannel, MessageHandler } from './channel.ts';

/**
 * A linked pair of in-memory channels: the brain runs the host in its own
 * process and they hand messages off directly (no serialization). This is the
 * default "local" instance — `server runs it directly itself`.
 *
 * Delivery is async (queueMicrotask) so behaviour matches a real transport:
 * a `send` never re-enters the sender's stack synchronously.
 */
export function linkedChannels(): { brain: BrainChannel; host: HostChannel } {
  let brainHandler: MessageHandler<HostToBrain> | null = null;
  let hostHandler: MessageHandler<BrainToHost> | null = null;
  let brainClose: CloseHandler | null = null;
  let hostClose: CloseHandler | null = null;
  const brainQueue: HostToBrain[] = [];
  const hostQueue: BrainToHost[] = [];
  let closed = false;

  const toBrain = (m: HostToBrain): void => {
    if (brainHandler) brainHandler(m);
    else brainQueue.push(m);
  };
  const toHost = (m: BrainToHost): void => {
    if (hostHandler) hostHandler(m);
    else hostQueue.push(m);
  };
  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      brainClose?.(undefined);
      hostClose?.(undefined);
    });
  };

  const brain: BrainChannel = {
    send(msg) {
      if (!closed) queueMicrotask(() => toHost(msg));
    },
    onMessage(h) {
      brainHandler = h;
      while (brainQueue.length) h(brainQueue.shift() as HostToBrain);
    },
    onClose(h) {
      brainClose = h;
    },
    close() {
      closeBoth();
      return Promise.resolve();
    },
  };

  const host: HostChannel = {
    send(msg) {
      if (!closed) queueMicrotask(() => toBrain(msg));
    },
    onMessage(h) {
      hostHandler = h;
      while (hostQueue.length) h(hostQueue.shift() as BrainToHost);
    },
    onClose(h) {
      hostClose = h;
    },
    close() {
      closeBoth();
      return Promise.resolve();
    },
  };

  return { brain, host };
}
