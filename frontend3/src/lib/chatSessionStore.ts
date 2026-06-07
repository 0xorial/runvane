import type { ChatEntry } from "@/protocol/chatEntry";
import { assertNever } from "@/utils/assertNever";
import { createObservable } from "@/utils/observable";
import {
  createObservableItemCollection,
  type ObservableItem,
  type ObservableItemCollection,
} from "@/utils/observableCollection";
import { SseType, type SseEvent } from "@/protocol/sseTypes";
import {
  activePathTipId,
  chooseBranchLine,
  chooseEntry,
  patchLinked,
  pathFromChosen,
  resolveViewTipFromAnchor,
  childEntries,
  siblingsOf,
  toLinkedEntries,
  type ChatEntryLookup,
  type LinkedChatEntry,
} from "./linkedChatEntry";

/** A message held server-side, awaiting the current run to finish before it posts. */
export type PendingMessage = { clientRequestId: string; text: string };

export class ChatSessionStore {
  private readonly rows: ObservableItemCollection<LinkedChatEntry>;
  private readonly pathVersion$ = createObservable({ value: 0 });
  private readonly pending$ = createObservable<{ items: PendingMessage[] }>({ items: [] });
  private viewAnchorId: string | null = null;

  constructor(initial: LinkedChatEntry[] = []) {
    this.rows = createObservableItemCollection(initial);
  }

  subscribeRows(listener: () => void): () => void {
    return this.rows.subscribeRows(listener);
  }

  getRowsVersion(): number {
    return this.rows.getRowsVersion();
  }

  subscribeActivePath(listener: () => void): () => void {
    return this.pathVersion$.subscribe(listener);
  }

  getActivePathVersion(): number {
    return this.pathVersion$.get().value;
  }

  subscribePending(listener: () => void): () => void {
    return this.pending$.subscribe(listener);
  }

  getPendingMessages(): PendingMessage[] {
    return this.pending$.get().items;
  }

  getById(id: string): ObservableItem<LinkedChatEntry> | undefined {
    return this.rows.getById(id);
  }

  getAllRows(): ObservableItem<LinkedChatEntry>[] {
    return this.rows.getRows().slice();
  }

  getActivePathRows(): ObservableItem<LinkedChatEntry>[] {
    return pathFromChosen(this.lookup())
      .map((entry) => this.rows.getById(entry.id))
      .filter((row$): row$ is ObservableItem<LinkedChatEntry> => row$ != null);
  }

  childEntries(parentId: string | null): LinkedChatEntry[] {
    return childEntries(this.lookup(), parentId);
  }

  siblingsOf(entryId: string): LinkedChatEntry[] {
    return siblingsOf(this.lookup(), entryId);
  }

  activePathTipId(): string | null {
    return activePathTipId(this.lookup());
  }

  appendEntry(entry: ChatEntry): boolean {
    return this.append(entry);
  }

  replace(entries: ChatEntry[], viewLeafId?: string | null, viewAnchorId?: string | null): void {
    this.rows.replace(toLinkedEntries(entries, viewLeafId));
    if (viewAnchorId !== undefined) this.viewAnchorId = viewAnchorId;
    this.syncViewPathFromAnchor();
  }

  hasViewAnchor(): boolean {
    return this.viewAnchorId !== null;
  }

  setViewAnchor(anchorId: string | null): void {
    this.viewAnchorId = anchorId;
    this.syncViewPathFromAnchor();
  }

  chooseBranchLine(startId: string): string {
    const tipId = chooseBranchLine(startId, this.lookup(), (id, chosen) => this.setChosen(id, chosen));
    this.bumpActivePath();
    return tipId;
  }

  setChosenPathFromLeaf(leafId: string): void {
    if (!this.trySetChosenPathFromLeaf(leafId)) {
      throw new Error(`ChatSessionStore: unknown leaf ${leafId}`);
    }
  }

  applySseEvent(ev: SseEvent, pending: Map<string, string>): void {
    switch (ev.type) {
      case SseType.CONVERSATION_CREATED:
        return;
      case SseType.CONVERSATION_UPDATED: {
        const anchorId = ev.conversation.defaultViewLeafAnchorId;
        if (anchorId) this.setViewAnchor(anchorId);
        return;
      }
      case SseType.TOOL_INVOCATION_START:
      case SseType.TOOL_INVOCATION_END:
        return;
      case SseType.MESSAGE_ENQUEUED: {
        const { clientRequestId, text } = ev;
        this.pending$.mutate((state) => {
          if (state.items.some((m) => m.clientRequestId === clientRequestId)) return;
          state.items = [...state.items, { clientRequestId, text }];
        });
        return;
      }
      case SseType.MESSAGE_DEQUEUED: {
        const { clientRequestId } = ev;
        this.pending$.mutate((state) => {
          state.items = state.items.filter((m) => m.clientRequestId !== clientRequestId);
        });
        return;
      }
      case SseType.USER_MESSAGE: {
        const optimisticId = ev.clientRequestId ? pending.get(ev.clientRequestId) : undefined;
        if (optimisticId && ev.clientRequestId) {
          pending.delete(ev.clientRequestId);
          if (!this.rekey(optimisticId, ev.entry)) this.append(ev.entry);
        } else {
          this.append(ev.entry);
        }
        if (ev.entry.type === "user-message") this.setViewAnchor(ev.entry.id);
        return;
      }
      case SseType.CHAT_ENTRY_UPSERT:
        this.upsert(ev.entry);
        if (ev.entry.type === "checkpoint-summary") {
          this.setViewAnchor(ev.entry.id);
        }
        return;
      case SseType.CHAT_ENTRY_DELTA: {
        const row$ = this.rows.getById(ev.chatEntryId);
        if (!row$) return;
        row$.mutate((current) => {
          const row = current as Record<string, unknown>;
          const prev = typeof row[ev.field] === "string" ? (row[ev.field] as string) : "";
          row[ev.field] = `${prev}${ev.delta}`;
        });
        return;
      }
      default:
        assertNever(ev);
    }
  }

  private syncViewPathFromAnchor(): void {
    const tipId = resolveViewTipFromAnchor(this.lookup(), this.viewAnchorId);
    if (tipId) this.trySetChosenPathFromLeaf(tipId);
  }

  private trySetChosenPathFromLeaf(leafId: string): boolean {
    const pathIds: string[] = [];
    let cursor: string | null = leafId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!this.rows.getById(cursor)) return false;
      pathIds.push(cursor);
      cursor = this.lookup().getById(cursor)?.parentId ?? null;
    }
    for (const id of pathIds) {
      chooseEntry(id, this.lookup(), (entryId, chosen) => this.setChosen(entryId, chosen));
    }
    this.bumpActivePath();
    return true;
  }

  private append(entry: ChatEntry): boolean {
    const linked: LinkedChatEntry = { ...entry, isChosen: false };
    if (!this.rows.append(linked)) return false;
    this.syncViewPathFromAnchor();
    return true;
  }

  private rekey(oldId: string, next: ChatEntry): boolean {
    const existing = this.lookup().getById(oldId);
    if (!existing) return false;
    const wasChosen = existing.isChosen;
    const linked = patchLinked(existing, next);
    if (!this.rows.replaceById(oldId, linked)) return false;
    if (wasChosen) {
      chooseEntry(linked.id, this.lookup(), (id, chosen) => this.setChosen(id, chosen));
    }
    this.syncViewPathFromAnchor();
    return true;
  }

  private upsert(entry: ChatEntry): "appended" | "patched" | "unchanged" {
    const existing = this.lookup().getById(entry.id);
    if (existing) {
      this.rows.replaceById(entry.id, patchLinked(existing, entry));
      this.syncViewPathFromAnchor();
      return "patched";
    }
    if (this.append(entry)) return "appended";
    return "unchanged";
  }

  private lookup(): ChatEntryLookup {
    return {
      getById: (id) => this.rows.getById(id)?.get(),
      getRows: () => this.rows.getRows().map((row$) => row$.get()),
    };
  }

  private setChosen(id: string, chosen: boolean): void {
    const row$ = this.rows.getById(id);
    if (!row$) throw new Error(`ChatSessionStore: unknown entry ${id}`);
    row$.mutate((entry) => {
      entry.isChosen = chosen;
    });
  }

  private bumpActivePath(): void {
    this.pathVersion$.mutate((state) => {
      state.value += 1;
    });
  }
}
