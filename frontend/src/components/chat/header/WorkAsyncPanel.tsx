import type { AsyncTaskEntry, AsyncWorkSummary } from "../../../../../backend/src/contracts/work";
import { cn } from "@/lib/utils";

type WorkAsyncPanelProps = {
  summary: AsyncWorkSummary;
  entries: AsyncTaskEntry[];
  conversationId: string | null;
  scopePending: number;
};

export function WorkAsyncPanel({ summary, entries, conversationId, scopePending }: WorkAsyncPanelProps) {
  const attributed = entries.filter((e) => e.attributed);
  const suspicious = entries.filter((e) => e.suspicious);
  const other = entries.filter((e) => !e.attributed && !e.suspicious);

  const localAttributed = attributed.filter((e) => conversationId && e.conversationId === conversationId);
  const otherAttributed = attributed.filter((e) => !conversationId || e.conversationId !== conversationId);

  return (
    <div className="border-b border-border/40">
      <VerdictBanner summary={summary} scopePending={scopePending} />
      {suspicious.length > 0 ? (
        <AsyncSection
          label="Unattributed app code"
          tone="alert"
          hint="backend/src frame with no lifecycle scope."
          entries={suspicious}
        />
      ) : null}
      {conversationId && localAttributed.length > 0 ? (
        <AsyncSection label="This conversation" entries={localAttributed} />
      ) : null}
      {otherAttributed.length > 0 ? (
        <AsyncSection
          label={conversationId ? "Other attributed" : "Attributed"}
          entries={otherAttributed}
        />
      ) : null}
      {other.length > 0 ? (
        <AsyncSection
          label="All other handles"
          tone="muted"
          hint="init = started · after = callback finished (removed). waiting = between init and after."
          entries={other}
        />
      ) : null}
    </div>
  );
}

function VerdictBanner({ summary, scopePending }: { summary: AsyncWorkSummary; scopePending: number }) {
  if (summary.suspicious > 0) {
    return (
      <div className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100">
        {summary.suspicious} unattributed backend/src handle{summary.suspicious === 1 ? "" : "s"} — see stacks
        below.
      </div>
    );
  }
  if (scopePending === 0 && summary.attributed === 0 && summary.unattributed_infra === 0) return null;
  return (
    <div className="mx-3 mt-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
      Scoped: {scopePending} · attributed async: {summary.attributed} · other handles:{" "}
      {summary.unattributed_infra}
    </div>
  );
}

function AsyncSection({
  label,
  hint,
  tone = "default",
  entries,
}: {
  label: string;
  hint?: string;
  tone?: "default" | "alert" | "muted";
  entries: AsyncTaskEntry[];
}) {
  return (
    <div className="border-t border-border/30">
      <div
        className={cn(
          "px-3 py-2 text-[10px] uppercase tracking-wider",
          tone === "alert" && "text-amber-700 dark:text-amber-300",
          tone === "muted" && "text-muted-foreground/70",
          tone === "default" && "text-muted-foreground",
        )}
      >
        {label} ({entries.length})
      </div>
      {hint ? <p className="px-3 pb-1 text-[10px] text-muted-foreground/80">{hint}</p> : null}
      <ul className="pb-1">
        {entries.map((entry) => (
          <AsyncEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

const ORIGIN_CLS: Record<AsyncTaskEntry["originClass"], string> = {
  none: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  app: "bg-amber-500/20 text-amber-800 dark:text-amber-200",
  framework: "bg-sky-500/20 text-sky-800 dark:text-sky-200",
  unknown: "bg-muted text-muted-foreground",
};

function AsyncEntryRow({ entry }: { entry: AsyncTaskEntry }) {
  return (
    <li className="border-t border-border/20 px-3 py-2 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] text-foreground/60">{entry.id}</span>
        <span className="rounded px-1 py-px text-[9px] uppercase tracking-wide bg-muted text-foreground/70">
          {entry.kind}
        </span>
        {entry.hookType ? (
          <span className="font-mono text-[9px] text-foreground/80">{entry.hookType}</span>
        ) : null}
        <span className="rounded px-1 py-px text-[9px] uppercase">{entry.state}</span>
        {entry.observingSelf ? (
          <span className="rounded bg-sky-500/15 px-1 py-px text-[9px] text-sky-700 dark:text-sky-300">
            this poll
          </span>
        ) : null}
        {entry.stale ? (
          <span className="rounded bg-orange-500/15 px-1 py-px text-[9px] text-orange-700 dark:text-orange-300">
            waiting long
          </span>
        ) : null}
        <span className={cn("rounded px-1 py-px text-[9px]", ORIGIN_CLS[entry.originClass])}>
          {entry.originClass}
        </span>
      </div>
      <div className="mt-1 break-all font-medium text-foreground/90">{entry.label}</div>
      <MetaLine entry={entry} />
      {entry.originStack.length > 0 ? (
        <pre className="mt-1.5 max-h-32 overflow-auto rounded border border-border/50 bg-muted/40 p-1.5 font-mono text-[9px] leading-snug text-foreground/85">
          {entry.originStack.join("\n")}
        </pre>
      ) : null}
    </li>
  );
}

function MetaLine({ entry }: { entry: AsyncTaskEntry }) {
  const parts: string[] = [];
  parts.push(`since ${formatAge(entry.scheduledAt)}`);
  if (entry.contextPath) parts.push(`scope: ${entry.contextPath}`);
  if (entry.conversationId) parts.push(`conv: ${entry.conversationId.slice(0, 8)}…`);
  if (entry.hookAsyncId != null) parts.push(`asyncId: ${entry.hookAsyncId}`);
  if (entry.triggerAsyncId != null) parts.push(`trigger: ${entry.triggerAsyncId}`);
  if (entry.originSite) parts.push(`site: ${entry.originSite}`);
  return <div className="mt-0.5 break-all font-mono text-[9px] opacity-75">{parts.join(" · ")}</div>;
}

function formatAge(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${(sec % 60).toString().padStart(2, "0")}s`;
}
