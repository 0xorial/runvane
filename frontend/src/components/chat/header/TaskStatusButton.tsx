import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Square, X } from "lucide-react";
import type { TaskInfo } from "../../../../../backend/src/contracts/task";
import { cancelTask } from "../../../api/client";
import { useTasks } from "../../../hooks/useTasks";
import { notifyError } from "../../../utils/toast";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { cn } from "@/lib/utils";

type TaskStatusButtonProps = {
  conversationId: string | null;
};

export function TaskStatusButton({ conversationId }: TaskStatusButtonProps) {
  const { tasks } = useTasks();
  const [open, setOpen] = useState(false);

  const { local, others } = useMemo(() => {
    const local: TaskInfo[] = [];
    const others: TaskInfo[] = [];
    for (const t of tasks) {
      if (conversationId && t.conversationId === conversationId) local.push(t);
      else others.push(t);
    }
    return { local, others };
  }, [tasks, conversationId]);

  const total = tasks.length;
  const localCount = local.length;
  const active = total > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${total} task${total === 1 ? "" : "s"} running` : "No tasks running"}
          title={active ? `${total} running` : "No tasks"}
          className={cn(
            "relative inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs transition-colors",
            active
              ? "bg-primary/15 text-primary hover:bg-primary/25"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          ) : (
            <Activity className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {active ? <span className="tabular-nums">{total}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[1400] w-80 rounded-lg border border-border bg-popover p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            Tasks <span className="ml-1 text-muted-foreground">({total})</span>
          </span>
          {localCount > 0 && conversationId ? (
            <button
              type="button"
              onClick={() => {
                for (const t of local) void safeCancel(t.id);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Cancel all tasks on this conversation"
            >
              <Square className="h-3 w-3" />
              Cancel this conversation
            </button>
          ) : null}
        </div>
        {total === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">No tasks in flight.</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {conversationId && local.length > 0 ? (
              <TaskGroup label="This conversation" tasks={local} />
            ) : null}
            {others.length > 0 ? (
              <TaskGroup
                label={conversationId ? "Other conversations" : "All tasks"}
                tasks={others}
              />
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TaskGroup({ label, tasks }: { label: string; tasks: TaskInfo[] }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <ul className="pb-1">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({ task }: { task: TaskInfo }) {
  const elapsed = useElapsed(task.startedAt);
  const cancelling = task.status === "cancelling";
  return (
    <li className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
      <span
        className={cn(
          "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
          cancelling ? "bg-amber-500" : task.kind === "tool" ? "bg-sky-500" : "bg-emerald-500",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground">{task.title}</span>
        <span className="block text-[10px] text-muted-foreground">
          {task.kind}
          <span className="mx-1">·</span>
          {elapsed}
          {cancelling ? (
            <>
              <span className="mx-1">·</span>
              <span className="text-amber-600 dark:text-amber-400">cancelling…</span>
            </>
          ) : null}
        </span>
      </span>
      <button
        type="button"
        disabled={cancelling}
        onClick={() => void safeCancel(task.id)}
        title="Cancel task"
        aria-label="Cancel task"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startMs = Date.parse(startedAt);
  const sec = Math.max(0, Math.round((now - (Number.isFinite(startMs) ? startMs : now)) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

async function safeCancel(id: string): Promise<void> {
  try {
    await cancelTask(id);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    notifyError(`Failed to cancel task: ${detail}`);
  }
}
