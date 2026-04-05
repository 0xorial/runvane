import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  createConversation,
  getConversations,
  postConversationMessage,
  renameConversation,
} from "../api/client";
import { subscribeGlobalLive } from "../protocol/runLiveClient";
import { SseType } from "../protocol/sseTypes";
import { notifyError } from "../utils/toast";
import { cx } from "../utils/cx";
import styles from "./ConversationSidebar.module.css";

export type ConversationRow = {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
};

type ConversationSidebarProps = {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
};

const PROBE_MESSAGE = "what is the time?";

export function ConversationSidebar({
  activeConversationId,
  onSelect,
  onNewChat,
}: ConversationSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [probeBusy, setProbeBusy] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const data = (await getConversations()) as ConversationRow[];
    setConversations(data);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const dispose = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.CONVERSATION_CREATED) {
          setConversations((prev) => {
            if (prev.some((item) => item.id === ev.conversation.id)) return prev;
            return [ev.conversation, ...prev];
          });
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED) {
          setConversations((prev) =>
            prev.map((item) =>
              item.id === ev.conversation.id
                ? {
                    ...item,
                    title: ev.conversation.title,
                    updated_at: ev.conversation.updated_at,
                  }
                : item,
            ),
          );
        }
      },
      pollTick: async () => false,
    });
    return () => dispose();
  }, []);

  async function onProbeTime() {
    if (probeBusy) return;
    setProbeBusy(true);
    try {
      const agentId = searchParams.get("agent")?.trim() || "";
      if (!agentId) {
        notifyError("Select an agent first");
        return;
      }
      const created = await createConversation({
        title: "New chat",
      });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");

      await postConversationMessage(id, {
        message: PROBE_MESSAGE,
        agent_id: agentId,
      });

      void loadConversations();
      navigate({
        pathname: `/chat/${encodeURIComponent(id)}`,
        search: location.search,
      });
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbeBusy(false);
    }
  }

  async function onRenameConversation(conversation: ConversationRow) {
    const current = String(conversation.title || "").trim();
    const next = window.prompt("Rename chat", current);
    if (next == null) {
      setMenuOpenId(null);
      return;
    }
    const title = next.trim();
    if (!title || title === current) {
      setMenuOpenId(null);
      return;
    }
    try {
      const updated = await renameConversation(conversation.id, { title });
      setConversations((prev) =>
        prev.map((item) => (item.id === updated.id ? { id: updated.id, title: updated.title } : item)),
      );
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenuOpenId(null);
    }
  }

  return (
    <aside className={styles.sidebar}>
      <button
        type="button"
        className={cx("btn", styles.newChatBtn)}
        onClick={onNewChat}
      >
        + New chat
      </button>
      <button
        type="button"
        className={cx("btn", styles.probeChatBtn)}
        onClick={() => void onProbeTime()}
        disabled={probeBusy}
      >
        Probe: time (tmp)
      </button>
      <div className={styles.convList}>
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cx(
              styles.convItem,
              activeConversationId === c.id && styles.convItemActive
            )}
            onClick={() => onSelect(c.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(c.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className={styles.convItemInner}>
              <span className={styles.convTitle}>{c.title}</span>
              <div className={styles.convMenuWrap}>
                <button
                  type="button"
                  className={styles.convMenuBtn}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpenId((prev) => (prev === c.id ? null : c.id));
                  }}
                  aria-label="Chat menu"
                  title="Chat menu"
                >
                  &#8942;
                </button>
                {menuOpenId === c.id ? (
                  <div
                    className={styles.convMenu}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={styles.convMenuItem}
                      onClick={() => void onRenameConversation(c)}
                    >
                      Rename
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
