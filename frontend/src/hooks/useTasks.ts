import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api/client";
import type { TaskInfo, TaskSseEvent } from "../../../backend/src/contracts/task";
import { TaskSseType } from "../../../backend/src/contracts/task";

/**
 * Subscribes to `/api/tasks/stream` and maintains an ordered list of in-flight
 * tasks. The stream begins with a `task_snapshot` event so refreshes converge
 * to the server's truth.
 */
export function useTasks(): { tasks: TaskInfo[]; connected: boolean } {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      es = new EventSource(`${API_BASE_URL}/api/tasks/stream`);
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        retryTimer = setTimeout(open, 1500);
      };
      es.onmessage = (msg) => {
        if (!msg.data) return;
        const parsed = JSON.parse(msg.data) as TaskSseEvent;
        applyEvent(parsed);
      };
    };

    const applyEvent = (ev: TaskSseEvent) => {
      if (ev.type === TaskSseType.SNAPSHOT) {
        setTasks(ev.tasks);
      } else if (ev.type === TaskSseType.UPSERT) {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === ev.task.id);
          if (idx < 0) return [...prev, ev.task];
          const next = prev.slice();
          next[idx] = ev.task;
          return next;
        });
      } else if (ev.type === TaskSseType.REMOVED) {
        setTasks((prev) => prev.filter((t) => t.id !== ev.id));
      }
    };

    open();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  return { tasks, connected };
}
