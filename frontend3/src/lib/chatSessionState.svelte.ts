import { setConversationDefaultViewLeaf } from "@/api/client";
import {
  getChatSessionStore,
  getEmptyChatSessionStore,
  retainChatSessionLive,
} from "@/lib/chatSessionRegistry";
import type { ChatSessionStore } from "@/lib/chatSessionStore";
import { fetchConversationSession, type ConversationSession } from "@/hooks/queries/conversations";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/hooks/queries/keys";
import { mapApiMessagesToChatEntries } from "@/utils/chatEntries";
import type { ObservableItem } from "@/utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";

export function createChatSessionState(getConversationId: () => string | null) {
  let isSessionLoading = $state(false);
  let rowsTick = $state(0);
  let pathTick = $state(0);
  let store: ChatSessionStore | null = $state(null);

  function bumpRows(): void {
    rowsTick += 1;
  }

  function bumpPath(): void {
    pathTick += 1;
  }

  let releaseLive: (() => void) | null = null;
  let rowUnsub: (() => void) | null = null;
  let pathUnsub: (() => void) | null = null;
  let pendingUnsub: (() => void) | null = null;

  function teardown(): void {
    rowUnsub?.();
    pathUnsub?.();
    pendingUnsub?.();
    rowUnsub = null;
    pathUnsub = null;
    pendingUnsub = null;
    releaseLive?.();
    releaseLive = null;
  }

  $effect(() => {
    const boundCid = getConversationId();
    teardown();

    if (!boundCid) {
      store = null;
      isSessionLoading = false;
      return;
    }

    const nextStore = getChatSessionStore(boundCid);
    store = nextStore;
    releaseLive = retainChatSessionLive();
    rowUnsub = nextStore.subscribeRows(bumpRows);
    pathUnsub = nextStore.subscribeActivePath(bumpPath);
    pendingUnsub = nextStore.subscribePending(bumpRows);

    const warmStore = nextStore.getAllRows().length > 0;
    const cachedSession = queryClient.getQueryData<ConversationSession>(
      queryKeys.conversationSession(boundCid),
    );

    if (warmStore && cachedSession) {
      isSessionLoading = false;
      return teardown;
    }

    isSessionLoading = !warmStore;
    let cancelled = false;

    void (async () => {
      try {
        const session = await fetchConversationSession(boundCid);
        if (cancelled) return;
        const entries = mapApiMessagesToChatEntries(session.entries);
        if (nextStore.getAllRows().length === 0) {
          nextStore.replace(entries, session.leafId, session.anchorId);
        } else {
          for (const entry of entries) {
            if (!nextStore.getById(entry.id)) nextStore.appendEntry(entry);
          }
          if (!nextStore.hasViewAnchor()) nextStore.setViewAnchor(session.anchorId);
        }
      } catch (err) {
        console.error("[chatSession] Failed to load conversation messages:", err);
        throw err;
      } finally {
        if (!cancelled) isSessionLoading = false;
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  });

  return {
    get store() {
      return store ?? getEmptyChatSessionStore();
    },
    get isSessionLoading() {
      return isSessionLoading;
    },
    get activePathEntries(): ObservableItem<LinkedChatEntry>[] {
      void rowsTick;
      void pathTick;
      return store?.getActivePathRows() ?? [];
    },
    async setActiveLeaf(entryId: string): Promise<void> {
      const boundCid = getConversationId();
      if (!boundCid || !store) return;
      if (!store.getById(entryId)) {
        const session = await fetchConversationSession(boundCid);
        store.replace(mapApiMessagesToChatEntries(session.entries), session.leafId, session.anchorId);
      }
      store.setChosenPathFromLeaf(entryId);
      const tipId = store.activePathTipId() ?? entryId;
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
    },
  };
}
