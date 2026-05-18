import * as net from 'net';
import type { SerialToolRules } from './rules.js';

const EXIT_MARKER_PREFIX = '---SERIAL_EXIT:';
const EXIT_MARKER_SUFFIX = '---';

type ConnectionState = 'disconnected' | 'connecting' | 'logging_in' | 'ready';

/** Parse "tcp://host:port" → { host, port }; otherwise treat as Unix socket path. */
function parseAddress(address: string): net.NetConnectOpts {
  if (address.startsWith('tcp://')) {
    const rest = address.slice('tcp://'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon === -1) throw new Error(`serial_terminal: invalid TCP address (missing port): ${address}`);
    const host = rest.slice(0, lastColon) || '127.0.0.1';
    const port = parseInt(rest.slice(lastColon + 1), 10);
    if (isNaN(port) || port < 1 || port > 65535) throw new Error(`serial_terminal: invalid TCP port in address: ${address}`);
    return { host, port };
  }
  return { path: address };
}

class SerialConnection {
  private socket: net.Socket | null = null;
  private state: ConnectionState = 'disconnected';
  private buffer = '';
  private readonly address: string;
  private readonly rules: SerialToolRules;

  constructor(socketPath: string, rules: SerialToolRules) {
    this.address = socketPath;
    this.rules = rules;
  }

  isConnected(): boolean {
    return this.state === 'ready' && this.socket !== null && !this.socket.destroyed;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;

    this.state = 'connecting';
    this.buffer = '';

    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(parseAddress(this.address));
      this.socket = sock;

      sock.setEncoding('utf8');

      const onError = (err: Error) => {
        this.state = 'disconnected';
        reject(new Error(`serial_terminal: socket error: ${err.message}`));
      };

      sock.once('error', onError);

      sock.once('connect', () => {
        sock.on('data', (chunk: string) => {
          this.buffer += chunk;
        });

        sock.on('close', () => {
          if (this.state !== 'disconnected') {
            this.state = 'disconnected';
          }
        });

        sock.on('error', (err: Error) => {
          // After initial connect errors are handled by the calling code
          void err;
        });

        this.doLogin(resolve, reject);
      });
    });
  }

  private doLogin(resolve: () => void, reject: (err: Error) => void): void {
    this.state = 'logging_in';
    const { login_username, login_password, prompt_pattern } = this.rules;
    const promptRegex = new RegExp(prompt_pattern);
    const loginRegex = /login:\s*$/i;
    const passwordRegex = /[Pp]assword:\s*$/;
    const timeoutMs = Math.min(30000, this.rules.max_timeout_ms);

    let loginSent = false;
    let passwordSent = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('serial_terminal: timed out waiting for shell prompt during login'));
      }
    }, timeoutMs);

    const poll = () => {
      if (settled) return;

      const buf = this.buffer;

      if (promptRegex.test(buf)) {
        clearTimeout(timer);
        settled = true;
        this.buffer = '';
        this.state = 'ready';
        resolve();
        return;
      }

      if (!loginSent && login_username && loginRegex.test(buf)) {
        loginSent = true;
        this.buffer = '';
        this.socket?.write(login_username + '\n');
        setTimeout(poll, 50);
        return;
      }

      if (!passwordSent && login_password && passwordRegex.test(buf)) {
        passwordSent = true;
        this.buffer = '';
        this.socket?.write(login_password + '\n');
        setTimeout(poll, 50);
        return;
      }

      setTimeout(poll, 50);
    };

    poll();
  }

  async exec(
    command: string,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<{ stdout: string; exitCode: number; truncated: boolean }> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('serial_terminal: socket is not connected');
    }

    this.buffer = '';

    const sentCommand = `${command}; echo "${EXIT_MARKER_PREFIX}$?${EXIT_MARKER_SUFFIX}"\n`;
    this.socket.write(sentCommand);

    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`serial_terminal: command timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const onClose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('serial_terminal: socket closed while waiting for command output'));
        }
      };

      this.socket?.once('close', onClose);

      const poll = () => {
        if (settled) return;

        const markerIndex = this.buffer.indexOf(EXIT_MARKER_PREFIX);
        if (markerIndex === -1) {
          setTimeout(poll, 20);
          return;
        }

        const markerEnd = this.buffer.indexOf(EXIT_MARKER_SUFFIX, markerIndex + EXIT_MARKER_PREFIX.length);
        if (markerEnd === -1) {
          setTimeout(poll, 20);
          return;
        }

        const exitCodeStr = this.buffer.slice(
          markerIndex + EXIT_MARKER_PREFIX.length,
          markerEnd,
        );
        const exitCode = parseInt(exitCodeStr, 10);

        // Strip the echo command line and the marker from output
        let rawOutput = this.buffer.slice(0, markerIndex);

        // Strip the echoed command itself (first line that matches the sent command echo)
        const echoLine = sentCommand.trimEnd();
        const echoIdx = rawOutput.indexOf(echoLine);
        if (echoIdx !== -1) {
          rawOutput = rawOutput.slice(echoIdx + echoLine.length);
        }

        // Strip any trailing newline after marker
        const afterMarker = markerEnd + EXIT_MARKER_SUFFIX.length;
        this.buffer = this.buffer.slice(afterMarker);

        settled = true;
        clearTimeout(timer);
        this.socket?.removeListener('close', onClose);

        let truncated = false;
        const encoder = new TextEncoder();
        const encoded = encoder.encode(rawOutput);
        if (encoded.byteLength > maxBytes) {
          truncated = true;
          const decoder = new TextDecoder();
          rawOutput = decoder.decode(encoded.slice(0, maxBytes));
        }

        resolve({
          stdout: rawOutput,
          exitCode: isNaN(exitCode) ? -1 : exitCode,
          truncated,
        });
      };

      poll();
    });
  }

  disconnect(): void {
    this.state = 'disconnected';
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
    this.buffer = '';
  }
}

export class SerialConnectionManager {
  private connections = new Map<string, SerialConnection>();

  getOrCreate(socketPath: string, rules: SerialToolRules): SerialConnection {
    let conn = this.connections.get(socketPath);
    if (!conn) {
      conn = new SerialConnection(socketPath, rules);
      this.connections.set(socketPath, conn);
    }
    return conn;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
  }
}
