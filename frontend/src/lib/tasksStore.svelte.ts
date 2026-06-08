import { API_BASE_URL } from "@/api/client";
import type { TaskInfo, TaskSseEvent } from "../../../backend/src/contracts/task";
import { TaskSseType } from "../../../backend/src/contracts/task";

let tasks = $state<TaskInfo[]>([]);
let connected = $state(false);

let started = false;

export function ensureTasksStream(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  let es: EventSource | null = null;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const applyEvent = (ev: TaskSseEvent): void => {
    if (ev.type === TaskSseType.SNAPSHOT) {
      tasks = ev.tasks;
    } else if (ev.type === TaskSseType.UPSERT) {
      const idx = tasks.findIndex((t) => t.id === ev.task.id);
      if (idx < 0) tasks = [...tasks, ev.task];
      else {
        const next = tasks.slice();
        next[idx] = ev.task;
        tasks = next;
      }
    } else if (ev.type === TaskSseType.REMOVED) {
      tasks = tasks.filter((t) => t.id !== ev.id);
    }
  };

  const open = (): void => {
    if (cancelled) return;
    es = new EventSource(`${API_BASE_URL}/api/tasks/stream`);
    es.onopen = () => {
      connected = true;
    };
    es.onerror = () => {
      connected = false;
      es?.close();
      es = null;
      retryTimer = setTimeout(open, 1500);
    };
    es.onmessage = (msg) => {
      if (!msg.data) return;
      applyEvent(JSON.parse(msg.data) as TaskSseEvent);
    };
  };

  open();
  window.addEventListener("beforeunload", () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    es?.close();
  });
}

export function getTasksSnapshot(): TaskInfo[] {
  return tasks;
}

export function isTasksConnected(): boolean {
  return connected;
}

export function conversationHasRunningTask(conversationId: string | null): boolean {
  if (!conversationId) return false;
  return tasks.some((t) => t.conversationId === conversationId && t.status === "running");
}
