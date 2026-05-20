import { Logger } from '@nestjs/common';
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import * as fs from 'fs';
import * as net from 'net';
import type { Server, WebSocket } from 'ws';
import { SerialConnectionManager } from '../tools/builtins/serial/connection.js';

const WS_OPEN = 1;

// ─── Session abstraction ─────────────────────────────────────────────────────

interface TerminalSession {
  write(data: string): void;
  destroy(): void;
}

/** Wraps a TCP net.Socket as a terminal session. */
function tcpSession(
  host: string,
  port: number,
  onData: (d: string) => void,
  onClose: () => void,
  onError: (msg: string) => void,
): Promise<TerminalSession> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });

    sock.once('connect', () => {
      sock.setEncoding('utf8');
      sock.on('data', (chunk: string) => onData(chunk));
      sock.on('close', onClose);
      sock.on('error', (err) => onError(err.message));
      resolve({
        write: (data) => { if (!sock.destroyed) sock.write(data); },
        destroy: () => { if (!sock.destroyed) sock.destroy(); },
      });
    });

    sock.once('error', reject);
  });
}

/** Wraps a PTY device file (e.g. /dev/ttys003) as a terminal session. */
function ptySession(
  devicePath: string,
  onData: (d: string) => void,
  onClose: () => void,
  onError: (msg: string) => void,
): Promise<TerminalSession> {
  return new Promise((resolve, reject) => {
    fs.open(devicePath, fs.constants.O_RDWR | fs.constants.O_NOCTTY, (err, fd) => {
      if (err) return reject(new Error(`Cannot open PTY device: ${err.message}`));

      let alive = true;
      const buf = Buffer.alloc(4096);

      function readLoop(): void {
        if (!alive) return;
        fs.read(fd, buf, 0, buf.length, null, (readErr, n) => {
          if (readErr || n === 0) {
            alive = false;
            fs.close(fd, () => {});
            onClose();
            return;
          }
          onData(buf.slice(0, n).toString('utf8'));
          readLoop();
        });
      }

      readLoop();

      resolve({
        write: (data) => {
          if (!alive) return;
          fs.write(fd, data, (writeErr) => {
            if (writeErr) onError(writeErr.message);
          });
        },
        destroy: () => {
          if (!alive) return;
          alive = false;
          fs.close(fd, () => {});
        },
      });
    });
  });
}

function openSession(
  address: string,
  onData: (d: string) => void,
  onClose: () => void,
  onError: (msg: string) => void,
): Promise<TerminalSession> {
  if (address.startsWith('tcp://')) {
    const rest = address.slice('tcp://'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon === -1) return Promise.reject(new Error(`Invalid TCP address (missing port): ${address}`));
    const host = rest.slice(0, lastColon) || '127.0.0.1';
    const port = parseInt(rest.slice(lastColon + 1), 10);
    if (isNaN(port) || port < 1 || port > 65535) return Promise.reject(new Error(`Invalid port in address: ${address}`));
    return tcpSession(host, port, onData, onClose, onError);
  }
  return ptySession(address, onData, onClose, onError);
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

@WebSocketGateway({ path: '/ws/terminal' })
export class TerminalGateway implements OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<WebSocket, TerminalSession>();
  /** Read-only observers: unsubscribe fn per client mirroring a serial line. */
  private readonly observers = new Map<WebSocket, () => void>();

  constructor(private readonly serialManager: SerialConnectionManager) {}

  /**
   * Read-only mirror of the agent's live serial session. Subscribes to the
   * shared SerialConnectionManager rather than opening a second connection
   * (QEMU serial sockets are single-client). Input from this client is ignored.
   */
  @SubscribeMessage('observe_serial')
  handleObserveSerial(client: WebSocket, data: { address: string }): void {
    this.closeSession(client);
    const address = (data?.address ?? '').trim();
    if (!address) {
      this.send(client, { type: 'error', message: 'address is required' });
      return;
    }
    const unsub = this.serialManager.observe(address, ({ dir, data: chunk }) => {
      // The agent's own writes use bare \n; normalise so xterm renders cleanly.
      const text = dir === 'out' ? chunk.replace(/\r?\n/g, '\r\n') : chunk;
      this.send(client, { type: 'data', data: text });
    });
    this.observers.set(client, unsub);
    this.send(client, { type: 'connected' });
  }

  @SubscribeMessage('connect_terminal')
  async handleConnectTerminal(client: WebSocket, data: { address: string }): Promise<void> {
    this.closeSession(client);

    const address = (data?.address ?? '').trim();
    if (!address) {
      this.send(client, { type: 'error', message: 'address is required' });
      return;
    }

    try {
      const session = await openSession(
        address,
        (chunk) => this.send(client, { type: 'data', data: chunk }),
        () => {
          this.sessions.delete(client);
          this.send(client, { type: 'disconnected' });
        },
        (msg) => this.send(client, { type: 'error', message: msg }),
      );
      this.sessions.set(client, session);
      this.send(client, { type: 'connected' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`terminal connect failed (${address}): ${msg}`);
      this.send(client, { type: 'error', message: msg });
    }
  }

  @SubscribeMessage('input')
  handleInput(client: WebSocket, data: { data: string }): void {
    this.sessions.get(client)?.write(data?.data ?? '');
  }

  @SubscribeMessage('disconnect_terminal')
  handleDisconnectTerminal(client: WebSocket): void {
    this.closeSession(client);
    this.send(client, { type: 'disconnected' });
  }

  handleDisconnect(client: WebSocket): void {
    this.closeSession(client);
  }

  private closeSession(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (session) {
      session.destroy();
      this.sessions.delete(client);
    }
    const unsub = this.observers.get(client);
    if (unsub) {
      unsub();
      this.observers.delete(client);
    }
  }

  private send(client: WebSocket, msg: unknown): void {
    if (client.readyState === WS_OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}
