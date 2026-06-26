import type { HarnessToHost, HostToHarness } from '../protocol/messages.ts';
import type { HarnessChannel, CloseHandler, HostChannel, MessageHandler } from './channel.ts';

/**
 * A linked pair of in-memory channels: the harness runs the host in its own
 * process and they hand messages off directly (no serialization). This is the
 * default "local" instance — `server runs it directly itself`.
 *
 * Delivery is async (queueMicrotask) so behaviour matches a real transport:
 * a `send` never re-enters the sender's stack synchronously.
 */
export function linkedChannels(): { harness: HarnessChannel; host: HostChannel } {
  let harnessHandler: MessageHandler<HostToHarness> | null = null;
  let hostHandler: MessageHandler<HarnessToHost> | null = null;
  let harnessClose: CloseHandler | null = null;
  let hostClose: CloseHandler | null = null;
  const harnessQueue: HostToHarness[] = [];
  const hostQueue: HarnessToHost[] = [];
  let closed = false;

  const toHarness = (m: HostToHarness): void => {
    if (harnessHandler) harnessHandler(m);
    else harnessQueue.push(m);
  };
  const toHost = (m: HarnessToHost): void => {
    if (hostHandler) hostHandler(m);
    else hostQueue.push(m);
  };
  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      harnessClose?.(undefined);
      hostClose?.(undefined);
    });
  };

  const harness: HarnessChannel = {
    send(msg) {
      if (!closed) queueMicrotask(() => toHost(msg));
    },
    onMessage(h) {
      harnessHandler = h;
      while (harnessQueue.length) h(harnessQueue.shift() as HostToHarness);
    },
    onClose(h) {
      harnessClose = h;
    },
    close() {
      closeBoth();
      return Promise.resolve();
    },
  };

  const host: HostChannel = {
    send(msg) {
      if (!closed) queueMicrotask(() => toHarness(msg));
    },
    onMessage(h) {
      hostHandler = h;
      while (hostQueue.length) h(hostQueue.shift() as HarnessToHost);
    },
    onClose(h) {
      hostClose = h;
    },
    close() {
      closeBoth();
      return Promise.resolve();
    },
  };

  return { harness, host };
}
