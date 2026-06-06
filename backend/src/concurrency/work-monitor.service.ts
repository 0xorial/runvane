import { Injectable } from '@nestjs/common';

export type PendingWorkKind = 'spawn' | 'run' | 'delay' | 'timer';

export type PendingWorkItem = {
  id: string;
  label: string;
  kind: PendingWorkKind;
  startedAt: string;
};

export type RegisteredWorkScope = {
  id: string;
  label: string;
  conversationId: string | null;
  registeredAt: string;
  pending: number;
  items: PendingWorkItem[];
};

@Injectable()
export class WorkMonitorService {
  private readonly scopes = new Map<string, RegisteredWorkScope>();

  registerScope(args: { label: string; conversationId?: string | null }): string {
    const id = crypto.randomUUID();
    this.scopes.set(id, {
      id,
      label: args.label,
      conversationId: args.conversationId ?? null,
      registeredAt: new Date().toISOString(),
      pending: 0,
      items: [],
    });
    return id;
  }

  unregisterScope(scopeId: string): void {
    this.scopes.delete(scopeId);
  }

  track(scopeId: string, item: PendingWorkItem): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) return;
    scope.items.push(item);
    scope.pending = scope.items.length;
  }

  untrack(scopeId: string, workId: string): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) return;
    scope.items = scope.items.filter((item) => item.id !== workId);
    scope.pending = scope.items.length;
  }

  listScopes(): RegisteredWorkScope[] {
    return [...this.scopes.values()]
      .map((scope) => ({
        ...scope,
        items: [...scope.items].sort(
          (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
        ),
      }))
      .sort((a, b) => Date.parse(b.registeredAt) - Date.parse(a.registeredAt));
  }

  totalPending(): number {
    let n = 0;
    for (const scope of this.scopes.values()) n += scope.pending;
    return n;
  }
}
