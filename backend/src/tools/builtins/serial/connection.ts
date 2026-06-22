import { Injectable } from '@nestjs/common';
import * as net from 'net';
import { randomBytes } from 'node:crypto';
import type { SerialToolRules } from './rules.js';

type ConnectionState = 'disconnected' | 'connecting' | 'logging_in' | 'ready';

/** A chunk of raw serial traffic, for read-only observers. */
export type SerialTraffic = { dir: 'in' | 'out'; data: string };
export type SerialObserver = (t: SerialTraffic) => void;
type TrafficSink = (dir: 'in' | 'out', data: string) => void;

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

// Strip ANSI/VT escape sequences (CSI colour codes, OSC, etc.) — Kali's
// prompt and many tools emit them and they are noise to the LLM. Built from a
// string so no literal control chars sit in the source.
const ANSI_RE = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)' +
    '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

function cleanOutput(raw: string): string {
  return raw.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
}

/** The signal's abort reason as an Error (Node's default reason is an AbortError). */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('serial_terminal: command aborted'), { name: 'AbortError' });
}

class SerialConnection {
  private socket: net.Socket | null = null;
  private state: ConnectionState = 'disconnected';
  private buffer = '';
  private readonly address: string;
  private readonly rules: SerialToolRules;
  /** Serialises run() calls — one serial line, one command at a time. */
  private lock: Promise<unknown> = Promise.resolve();
  /** Where raw traffic is mirrored for read-only observers. */
  private readonly sink: TrafficSink;

  constructor(socketPath: string, rules: SerialToolRules, sink: TrafficSink) {
    this.address = socketPath;
    this.rules = rules;
    this.sink = sink;
  }

  isConnected(): boolean {
    return this.state === 'ready' && this.socket !== null && !this.socket.destroyed;
  }

  /** Write to the socket; `mirror=false` keeps secrets (passwords) out of observers. */
  private send(data: string, mirror = true): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(data);
    if (mirror) this.sink('out', data);
  }

  /**
   * Public entry point. Serialises against other in-flight commands on the
   * same connection (one serial line = one command at a time), (re)connecting
   * as needed, with a single reconnect-retry on failure.
   */
  async run(
    command: string,
    timeoutMs: number,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<{ stdout: string; exitCode: number; truncated: boolean }> {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev.catch(() => undefined);
      signal?.throwIfAborted();
      if (!this.isConnected()) {
        await this.connect();
        await this.applyShellSetup();
      }
      try {
        return await this.execRaw(command, timeoutMs, maxBytes, signal);
      } catch (firstErr) {
        // A steering/user cancel must not trigger the wedged-session retry.
        if (signal?.aborted) throw firstErr;
        // The session may be wedged — drop it and retry once on a fresh one.
        this.disconnect();
        try {
          await this.connect();
          await this.applyShellSetup();
          return await this.execRaw(command, timeoutMs, maxBytes, signal);
        } catch {
          throw firstErr;
        }
      }
    } finally {
      release();
    }
  }

  private async connect(): Promise<void> {
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
          this.sink('in', chunk);
        });
        sock.on('close', () => {
          if (this.state !== 'disconnected') this.state = 'disconnected';
        });
        sock.on('error', () => {
          // Post-connect errors surface via the close handler / command polls.
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

    // A serial console that is already logged in (or sitting at `login:`)
    // prints nothing until prodded — send a newline to elicit a fresh prompt.
    this.send('\n');

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
        this.send(login_username + '\n');
        setTimeout(poll, 50);
        return;
      }
      if (!passwordSent && login_password && passwordRegex.test(buf)) {
        passwordSent = true;
        this.buffer = '';
        this.send(login_password + '\n', false); // never mirror the password
        setTimeout(poll, 50);
        return;
      }
      setTimeout(poll, 50);
    };

    poll();
  }

  /**
   * Best-effort: quiet the shell so command output is clean for the LLM.
   * `stty -echo` drops input echo; `TERM=dumb` discourages tools from
   * emitting colour. Failures are non-fatal — output parsing does not
   * depend on it (see execRaw's marker scheme).
   */
  private async applyShellSetup(): Promise<void> {
    try {
      await this.execRaw('export TERM=dumb; stty -echo 2>/dev/null', 5000, 4096);
    } catch {
      // ignore — purely cosmetic
    }
  }

  /**
   * Sends a command and recovers its output + exit code.
   *
   * Output is delimited by per-call random-nonce markers, NOT by stripping
   * the echoed command line:
   *   echo '<START>'
   *   <command>
   *   echo "<EXIT>:$?"
   * The shell PRINTS `<START>\n` on its own line; the echoed input line
   * (if TTY echo is on) contains `<START>'` — the regex requires a newline
   * right after the marker, so it locks onto the printed one. Everything
   * between the printed start line and the exit marker is the real output.
   * The nonce makes a collision with command output content infeasible.
   */
  private execRaw(
    command: string,
    timeoutMs: number,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<{ stdout: string; exitCode: number; truncated: boolean }> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('serial_terminal: socket is not connected'));
    }
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const socket = this.socket;
    const nonce = randomBytes(8).toString('hex');
    const startMarker = `__RUNVANE_START_${nonce}__`;
    const startRe = new RegExp(`${startMarker}\\r?\\n`);
    const exitRe = new RegExp(`__RUNVANE_EXIT_${nonce}:(-?\\d+)__`);

    this.buffer = '';
    this.send(`echo '${startMarker}'\n${command}\necho "__RUNVANE_EXIT_${nonce}:$?__"\n`);

    return new Promise((resolve, reject) => {
      let settled = false;
      let onAbort: (() => void) | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('close', onClose);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        // Best-effort: interrupt whatever is still running so the next
        // command does not execute inside a wedged program.
        try {
          this.send('\x03');
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error(`serial_terminal: command timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      const onClose = () =>
        finish(() => reject(new Error('serial_terminal: socket closed while waiting for command output')));
      socket.once('close', onClose);

      if (signal) {
        // Steering/user cancel: Ctrl-C the running command, then reject so the
        // shell session stays usable for the next command.
        onAbort = () => {
          try {
            this.send('\x03');
          } catch {
            /* ignore */
          }
          finish(() => reject(abortReason(signal)));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const poll = () => {
        if (settled) return;

        const startMatch = startRe.exec(this.buffer);
        if (!startMatch) {
          setTimeout(poll, 20);
          return;
        }
        const outputStart = startMatch.index + startMatch[0].length;

        const exitMatch = exitRe.exec(this.buffer.slice(outputStart));
        if (!exitMatch) {
          setTimeout(poll, 20);
          return;
        }

        const rawOutput = this.buffer.slice(outputStart, outputStart + exitMatch.index);
        const exitCode = Number.parseInt(exitMatch[1], 10);
        this.buffer = this.buffer.slice(outputStart + exitMatch.index + exitMatch[0].length);

        let cleaned = cleanOutput(rawOutput).replace(/\n$/, '');
        let truncated = false;
        const encoded = new TextEncoder().encode(cleaned);
        if (encoded.byteLength > maxBytes) {
          truncated = true;
          cleaned = new TextDecoder().decode(encoded.slice(0, maxBytes));
        }

        finish(() =>
          resolve({ stdout: cleaned, exitCode: Number.isNaN(exitCode) ? -1 : exitCode, truncated }),
        );
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

/**
 * Owns the one live SerialConnection per address (the shell session the agent
 * drives) and fans its raw traffic out to read-only observers — so a terminal
 * panel can mirror exactly what the agent is doing without opening a second
 * connection (QEMU serial sockets are single-client).
 */
@Injectable()
export class SerialConnectionManager {
  private readonly connections = new Map<string, SerialConnection>();
  private readonly observersByAddress = new Map<string, Set<SerialObserver>>();

  getOrCreate(socketPath: string, rules: SerialToolRules): SerialConnection {
    let conn = this.connections.get(socketPath);
    if (!conn) {
      conn = new SerialConnection(socketPath, rules, (dir, data) => this.fanout(socketPath, dir, data));
      this.connections.set(socketPath, conn);
    }
    return conn;
  }

  /**
   * Subscribe to a connection's raw traffic. Works whether or not a
   * connection for `address` exists yet — observers attach to the address,
   * and any connection later created for it fans out to them.
   */
  observe(address: string, fn: SerialObserver): () => void {
    let set = this.observersByAddress.get(address);
    if (!set) {
      set = new Set();
      this.observersByAddress.set(address, set);
    }
    set.add(fn);
    return () => {
      const s = this.observersByAddress.get(address);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.observersByAddress.delete(address);
    };
  }

  private fanout(address: string, dir: 'in' | 'out', data: string): void {
    const set = this.observersByAddress.get(address);
    if (!set) return;
    for (const fn of set) {
      try {
        fn({ dir, data });
      } catch {
        // a broken observer must not disrupt the serial session
      }
    }
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
  }
}
