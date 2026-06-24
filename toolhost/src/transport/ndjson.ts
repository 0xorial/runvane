import type { Readable, Writable } from 'node:stream';
import { isMessage } from '../protocol/messages.ts';
import type { CloseHandler, MessageChannel, MessageHandler } from './channel.ts';

/**
 * Build a MessageChannel from a readable (incoming) + writable (outgoing) byte
 * stream using NDJSON framing — one JSON object per `\n`-terminated line.
 *
 * Inbound messages arriving before a handler is registered are queued, so a
 * caller can construct the channel and wire handlers on the next statement
 * without racing the stream.
 */
export function streamChannel<TIn, TOut>(read: Readable, write: Writable): MessageChannel<TIn, TOut> {
  let handler: MessageHandler<TIn> | null = null;
  let closeHandler: CloseHandler | null = null;
  let ownClosed = false;
  let streamClosed = false;
  let closeErr: Error | undefined;
  const queue: TIn[] = [];
  let buffer = '';

  const deliver = (msg: TIn): void => {
    if (handler) handler(msg);
    else queue.push(msg);
  };

  const fail = (err?: Error): void => {
    if (streamClosed) return;
    streamClosed = true;
    closeErr = err;
    if (closeHandler) closeHandler(err);
  };

  read.setEncoding('utf8');
  read.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = undefined; // stray non-JSON line (e.g. a leaked log) — skip
        }
        if (isMessage(parsed)) deliver(parsed as TIn);
      }
      nl = buffer.indexOf('\n');
    }
  });
  read.on('end', () => fail());
  read.on('close', () => fail());
  read.on('error', (err: Error) => fail(err));
  write.on('error', (err: Error) => fail(err));

  return {
    send(msg: TOut): void {
      if (ownClosed || streamClosed) return;
      write.write(JSON.stringify(msg) + '\n');
    },
    onMessage(h: MessageHandler<TIn>): void {
      handler = h;
      while (queue.length) h(queue.shift() as TIn);
    },
    onClose(h: CloseHandler): void {
      closeHandler = h;
      if (streamClosed) h(closeErr);
    },
    close(): Promise<void> {
      if (!ownClosed) {
        ownClosed = true;
        write.end();
      }
      return Promise.resolve();
    },
  };
}
