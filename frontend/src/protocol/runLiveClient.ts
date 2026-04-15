import { API_BASE_URL } from "../api/client";
import { rvInfo } from "../utils/runvaneDiag";
import { parseSseEventObject } from "./parseSseEventObject";
import type { SseEvent } from "./sseTypes";

export type GlobalLiveHandlers = {
  onSseEvent: (ev: SseEvent) => void;
};

export type GlobalPollHandler = () => Promise<boolean> | boolean;

const DEFAULT_POLL_MS = 450;
const DEFAULT_RECOVERY_MS = 2500;
const DEFAULT_MAX_RECOVERY_WAITS = 12;
const LAST_SEQ_STORAGE_KEY = "runvane:sse:last-seq";

function readLastSeenSeq(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEQ_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  } catch {
    return null;
  }
}

function writeLastSeenSeq(seq: number): void {
  try {
    window.localStorage.setItem(LAST_SEQ_STORAGE_KEY, String(Math.trunc(seq)));
  } catch {
    // Best-effort only.
  }
}

type GlobalLiveOptions = {
  apiBaseUrl?: string;
  pollIntervalMs?: number;
  recoveryCheckMs?: number;
  maxRecoveryWaits?: number;
};

let es: EventSource | null = null;
let disposed = false;
let recoveryWaits = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let pollId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<GlobalLiveHandlers>();
const pollSubscribers = new Set<GlobalPollHandler>();

function cleanupGlobal(): void {
  if (recoveryTimer != null) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  if (pollId != null) clearInterval(pollId);
  pollId = null;
  if (es != null) {
    try {
      es.close();
    } catch (e) {
      console.error("[runvane] EventSource.close failed", e);
    }
  }
  es = null;
}

function maybeCleanupGlobal(): void {
  if (subscribers.size === 0 && pollSubscribers.size === 0) cleanupGlobal();
}

function startPoll(pollMs: number): void {
  if (pollId != null) return;
  pollId = setInterval(() => {
    void (async () => {
      for (const pollTick of [...pollSubscribers]) {
        try {
          const stop = await pollTick();
          if (stop === true) pollSubscribers.delete(pollTick);
        } catch (e) {
          console.error("[runvane] global poll tick failed", e);
        }
      }
      maybeCleanupGlobal();
    })();
  }, pollMs);
}

function ensureGlobalSse(options?: GlobalLiveOptions): void {
  if (es != null || disposed) return;
  const base = options?.apiBaseUrl ?? API_BASE_URL;
  const afterSeq = readLastSeenSeq();
  const streamUrl =
    afterSeq != null && afterSeq > 0
      ? `${base}/api/stream?after_seq=${encodeURIComponent(String(afterSeq))}`
      : `${base}/api/stream`;
  const pollMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const recoveryMs = options?.recoveryCheckMs ?? DEFAULT_RECOVERY_MS;
  const maxWaits = options?.maxRecoveryWaits ?? DEFAULT_MAX_RECOVERY_WAITS;
  es = new EventSource(streamUrl);

  const scheduleRecovery = () => {
    if (recoveryTimer != null || es == null) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (disposed || es === null) return;
      if (es.readyState === EventSource.OPEN) return;
      if (es.readyState === EventSource.CLOSED) {
        cleanupGlobal();
        startPoll(pollMs);
        return;
      }
      recoveryWaits += 1;
      if (recoveryWaits >= maxWaits) {
        cleanupGlobal();
        startPoll(pollMs);
        return;
      }
      scheduleRecovery();
    }, recoveryMs);
  };

  es.onopen = () => {
    recoveryWaits = 0;
    if (recoveryTimer != null) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (pollId != null) {
      clearInterval(pollId);
      pollId = null;
    }
    rvInfo("[runvane:sse] EventSource OPEN", streamUrl);
  };

  es.onerror = () => {
    if (disposed || es === null) return;
    if (pollId != null) return;
    scheduleRecovery();
  };

  es.onmessage = (event) => {
    if (disposed) return;
    try {
      const raw = JSON.parse(event.data) as unknown;
      const ev = parseSseEventObject(raw);
      if (!ev) return;
      if (typeof ev.seq === "number" && Number.isFinite(ev.seq)) {
        writeLastSeenSeq(ev.seq);
      }
      rvInfo("[runvane:sse] parsed", ev.type);
      for (const sub of [...subscribers]) {
        sub.onSseEvent(ev);
      }
    } catch (err) {
      console.error("[runvane] global SSE message error", err);
    }
  };
}

export function subscribeGlobalLive(
  handlers: GlobalLiveHandlers,
  options?: {
    apiBaseUrl?: string;
    pollIntervalMs?: number;
    recoveryCheckMs?: number;
    maxRecoveryWaits?: number;
  }
): () => void {
  disposed = false;
  subscribers.add(handlers);
  ensureGlobalSse(options);
  return () => {
    subscribers.delete(handlers);
    maybeCleanupGlobal();
  };
}

// TODO AI SLOP thinks polling should be exposed

export function subscribeGlobalPoll(
  pollTick: GlobalPollHandler,
  options?: {
    apiBaseUrl?: string;
    pollIntervalMs?: number;
    recoveryCheckMs?: number;
    maxRecoveryWaits?: number;
  }
): () => void {
  disposed = false;
  pollSubscribers.add(pollTick);
  ensureGlobalSse(options);
  return () => {
    pollSubscribers.delete(pollTick);
    maybeCleanupGlobal();
  };
}
