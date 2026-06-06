import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RegisteredWorkScope } from "../../../../../backend/src/contracts/work";
import { useWorkScopes } from "../../../hooks/useWorkScopes";
import { cn } from "@/lib/utils";
import { WorkAsyncPanel } from "./WorkAsyncPanel";

type WorkSuperDetailsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
};

const KIND_CLS: Record<RegisteredWorkScope["items"][number]["kind"], string> = {
  spawn: "bg-violet-500",
  run: "bg-fuchsia-500",
  delay: "bg-orange-500",
  timer: "bg-slate-400",
};

export function WorkSuperDetails({ open, onOpenChange, conversationId }: WorkSuperDetailsProps) {
  const { data, loading, error } = useWorkScopes(open);

  const { local, others, totalPending, scopePending, asyncPending } = useMemo(() => {
    const scopes = data?.scopes ?? [];
    const local: RegisteredWorkScope[] = [];
    const others: RegisteredWorkScope[] = [];
    for (const scope of scopes) {
      if (conversationId && scope.conversationId === conversationId) local.push(scope);
      else others.push(scope);
    }
    return {
      local,
      others,
      totalPending: data?.pending_work ?? 0,
      scopePending: data?.pending_scopes ?? 0,
      asyncPending: data?.pending_async ?? 0,
    };
  }, [data, conversationId]);

  const asyncSummary = data?.async_summary ?? { attributed: 0, suspicious: 0, unattributed_infra: 0 };
  const asyncEntries = data?.async_entries ?? [];

  return (
    <div className={cn("flex min-h-0 flex-col border-t border-border", open && "flex-1")}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="font-medium">Super details</span>
        <span className="text-muted-foreground/80">· work monitor</span>
        {asyncSummary.suspicious > 0 ? (
          <span className="ml-auto text-amber-600 dark:text-amber-400">{asyncSummary.suspicious} orphan</span>
        ) : totalPending > 0 ? (
          <span className="ml-auto tabular-nums text-foreground/70">{totalPending} pending</span>
        ) : null}
      </button>
      {open ? (
        <div className="min-h-[6rem] flex-1 overflow-y-auto border-t border-border/60 bg-muted/20 pb-2">
          {loading && !data ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading…</div>
          ) : null}
          {error ? <div className="px-3 py-2 text-[11px] text-destructive">{error}</div> : null}
          {!error && scopePending === 0 && asyncPending === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">Nothing in flight.</div>
          ) : null}
          {conversationId && local.length > 0 ? (
            <ScopeGroup label="This conversation — scopes" scopes={local} />
          ) : null}
          {others.length > 0 ? (
            <ScopeGroup label={conversationId ? "Other scopes" : "Lifecycle scopes"} scopes={others} />
          ) : null}
          {asyncPending > 0 ? (
            <WorkAsyncPanel
              summary={asyncSummary}
              entries={asyncEntries}
              conversationId={conversationId}
              scopePending={scopePending}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScopeGroup({ label, scopes }: { label: string; scopes: RegisteredWorkScope[] }) {
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <ul>
        {scopes.map((scope) => (
          <ScopeRow key={scope.id} scope={scope} />
        ))}
      </ul>
    </div>
  );
}

function ScopeRow({ scope }: { scope: RegisteredWorkScope }) {
  return (
    <li className="px-3 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
        <span className="min-w-0 break-all font-medium text-foreground">{scope.label}</span>
        <span className="text-muted-foreground">{scope.pending} pending</span>
      </div>
      {scope.items.length > 0 ? (
        <ul className="mt-1 space-y-0.5 pl-2">
          {scope.items.map((item) => (
            <li key={item.id} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn("mt-1.5 inline-flex h-1 w-1 shrink-0 rounded-full", KIND_CLS[item.kind])} />
              <span className="min-w-0 flex-1 break-all text-foreground/80">{item.label}</span>
              <span className="shrink-0 opacity-60">{item.kind}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-0.5 pl-2 text-[10px] text-muted-foreground/70">scope registered, no tracked branches</div>
      )}
    </li>
  );
}
