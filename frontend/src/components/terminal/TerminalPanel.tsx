import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ─── WebSocket protocol types ─────────────────────────────────────────────────

type ServerMsg =
  | { type: "connected" }
  | { type: "data"; data: string }
  | { type: "error"; message: string }
  | { type: "disconnected" };

type ConnectionState = "idle" | "connecting" | "connected" | "error" | "disconnected";

const WS_URL = `ws://${window.location.hostname}:3000/ws/terminal`;

const STORED_ADDRESS_KEY = "runvane_terminal_address";

function loadStoredAddress(): string {
  try {
    return localStorage.getItem(STORED_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveAddress(addr: string): void {
  try {
    localStorage.setItem(STORED_ADDRESS_KEY, addr);
  } catch {
    /* ignore */
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TerminalPanel({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [address, setAddress] = useState(loadStoredAddress);
  const [state, setState] = useState<ConnectionState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // ── xterm initialisation (once) ──────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      theme: { background: "#0d0d0d", foreground: "#e5e5e5", cursor: "#e5e5e5" },
      fontFamily: "\"Cascadia Code\", \"Fira Code\", \"JetBrains Mono\", Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(el);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ── Forward keystrokes to server ─────────────────────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "input", data: { data } }));
      }
    });
    return () => disposable.dispose();
  }, []);

  // ── Connect ───────────────────────────────────────────────────────────────
  function connect() {
    const addr = address.trim();
    if (!addr) return;
    saveAddress(addr);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState("connecting");
    setErrorMsg("");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: "connect_terminal", data: { address: addr } }));
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "connected":
          setState("connected");
          termRef.current?.focus();
          fitRef.current?.fit();
          break;
        case "data":
          termRef.current?.write(msg.data);
          break;
        case "error":
          setErrorMsg(msg.message);
          setState("error");
          break;
        case "disconnected":
          setState("disconnected");
          break;
      }
    };

    ws.onerror = () => {
      setErrorMsg("WebSocket connection to backend failed");
      setState("error");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setState((s) => (s === "connected" || s === "connecting" ? "disconnected" : s));
      }
    };
  }

  function disconnect() {
    const ws = wsRef.current;
    if (ws) {
      ws.send(JSON.stringify({ event: "disconnect_terminal", data: {} }));
      ws.close();
      wsRef.current = null;
    }
    setState("idle");
  }

  const isConnected = state === "connected";
  const isBusy = state === "connecting";

  const statusDot =
    state === "connected"
      ? "bg-green-500"
      : state === "connecting"
        ? "bg-yellow-400 animate-pulse"
        : state === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/40";

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden bg-[#0d0d0d]", className)}>
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-card/60 px-3 py-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot)} />
        <input
          className="min-w-0 flex-1 rounded border border-border/50 bg-background/60 px-2 py-0.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="tcp://127.0.0.1:4444  or  /dev/ttys003"
          value={address}
          disabled={isConnected || isBusy}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isConnected && !isBusy) connect(); }}
          spellCheck={false}
        />
        {isConnected ? (
          <button
            className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-red-400 hover:bg-red-500/10"
            onClick={disconnect}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
            disabled={isBusy || !address.trim()}
            onClick={connect}
          >
            {isBusy ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {/* error banner */}
      {(state === "error" || state === "disconnected") && (
        <div className={cn(
          "shrink-0 px-3 py-1 text-[11px]",
          state === "error" ? "bg-red-950/60 text-red-300" : "bg-muted/30 text-muted-foreground"
        )}>
          {state === "error" ? `Error: ${errorMsg}` : "Connection closed."}
        </div>
      )}

      {/* xterm viewport */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-1" />
    </div>
  );
}
