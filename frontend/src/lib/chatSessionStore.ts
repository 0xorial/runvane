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
  extendsChosenPath,
  patchLinked,
  pathFromChosen,
  childEntries,
  siblingsOf,
  toLinkedEntries,
  type ChatEntryLookup,
  type LinkedChatEntry,
} from "./linkedChatEntry";

export class ChatSessionStore {
  private readonly rows: ObservableItemCollection<LinkedChatEntry>;
  private readonly pathVersion$ = createObservable({ value: 0 });

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

  replace(entries: ChatEntry[], viewLeafId?: string | null): void {
    this.rows.replace(toLinkedEntries(entries, viewLeafId));
    this.bumpActivePath();
  }

  chooseBranchLine(startId: string): string {
    const tipId = chooseBranchLine(startId, this.lookup(), (id, chosen) => this.setChosen(id, chosen));
    this.bumpActivePath();
    return tipId;
  }

  setChosenPathFromLeaf(leafId: string): void {
    const pathIds: string[] = [];
    let cursor: string | null = leafId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!this.rows.getById(cursor)) throw new Error(`ChatSessionStore: unknown leaf ${leafId}`);
      pathIds.push(cursor);
      cursor = this.lookup().getById(cursor)?.parentId ?? null;
    }
    for (const id of pathIds) {
      chooseEntry(id, this.lookup(), (entryId, chosen) => this.setChosen(entryId, chosen));
    }
    this.bumpActivePath();
  }

  applySseEvent(ev: SseEvent, pending: Map<string, string>): void {
    switch (ev.type) {
      case SseType.CONVERSATION_CREATED:
      case SseType.CONVERSATION_UPDATED:
      case SseType.TOOL_INVOCATION_START:
      case SseType.TOOL_INVOCATION_END:
        return;
      case SseType.USER_MESSAGE: {
        const optimisticId = ev.clientRequestId ? pending.get(ev.clientRequestId) : undefined;
        if (optimisticId && ev.clientRequestId) {
          pending.delete(ev.clientRequestId);
          if (!this.rekey(optimisticId, ev.entry)) this.append(ev.entry);
          return;
        }
        this.append(ev.entry);
        return;
      }
      case SseType.CHAT_ENTRY_UPSERT:
        this.upsert(ev.entry);
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

  private append(entry: ChatEntry): boolean {
    const linked: LinkedChatEntry = { ...entry, isChosen: false };
    if (!this.rows.append(linked)) return false;
    if (extendsChosenPath(this.lookup(), entry.parentId)) {
      chooseEntry(linked.id, this.lookup(), (id, chosen) => this.setChosen(id, chosen));
      this.bumpActivePath();
    }
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
      this.bumpActivePath();
    }
    return true;
  }

  private upsert(entry: ChatEntry): "appended" | "patched" | "unchanged" {
    const existing = this.lookup().getById(entry.id);
    if (existing) {
      this.rows.replaceById(entry.id, patchLinked(existing, entry));
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
