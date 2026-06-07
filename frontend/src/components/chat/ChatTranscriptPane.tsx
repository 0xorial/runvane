import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ObservableItem } from "@/utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import { AgentCardsEmptyState } from "./AgentCardsEmptyState";
import { ChatMessageRow, messageRowKey, type ThoughtTripletRefs } from "./ChatMessageRow";
import { Spinner } from "../ui/Spinner";
import { AnchorTopScrollArea } from "../ui/AnchorTopScrollArea";

type ChatTranscriptPaneProps = {
  conversationId: string | null;
  visibleEntries: ObservableItem<LinkedChatEntry>[];
  thoughtTripletsById: ReadonlyMap<string, ThoughtTripletRefs>;
  isSessionLoading: boolean;
  selectedAgentId: string;
  topAnchorEntryId: string | null;
};

function ChatTranscriptPaneImpl({
  conversationId,
  visibleEntries,
  thoughtTripletsById,
  isSessionLoading,
  selectedAgentId,
  topAnchorEntryId,
}: ChatTranscriptPaneProps) {
  return (
    <AnchorTopScrollArea
      data-testid="chat-transcript"
      className={cn("scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden")}
      topAnchorEntryId={topAnchorEntryId}
    >
      {conversationId && visibleEntries.length > 0 ? (
        visibleEntries.map((entry$) => {
          const entry = entry$.get();
          return (
            <div
              key={messageRowKey(entry$)}
              data-chat-entry-id={entry.id}
              data-chat-entry-type={entry.type}
              {...(entry.type === "thought-prepare" ? { "data-chat-prepare-title": entry.title ?? "" } : {})}
            >
              <ChatMessageRow
                entry$={entry$}
                conversationId={conversationId}
                thoughtTripletsById={thoughtTripletsById}
              />
            </div>
          );
        })
      ) : conversationId && isSessionLoading && visibleEntries.length === 0 ? (
        <div
          data-testid="chat-loading"
          className="flex min-h-[12rem] flex-1 items-center justify-center p-8 text-muted-foreground"
        >
          <Spinner size={16} />
        </div>
      ) : (
        <AgentCardsEmptyState selectedAgentId={selectedAgentId} />
      )}
    </AnchorTopScrollArea>
  );
}

export const ChatTranscriptPane = memo(ChatTranscriptPaneImpl);
