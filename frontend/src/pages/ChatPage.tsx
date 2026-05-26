import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  createConversation,
  postConversationMessage,
  uploadFile,
  type AttachmentMode,
  type PostMessageAttachment,
} from "../api/client";
import {
  agentIdFromSearchParams,
  ChatAgentToolbar,
  type ChatAgentSelection,
} from "../components/chat/ChatAgentToolbar";
import { ChatTitlePanel } from "../components/chat/header/ChatTitlePanel";
import { ConversationBranchesPanel } from "../components/chat/ConversationBranchesPanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { MessageComposer } from "../components/chat/MessageComposer";
import { AttachmentChips, type SelectedAttachment } from "../components/chat/AttachmentChips";
import { ChatMessageRow, messageRowKey, type ThoughtTripletRefs } from "../components/chat/ChatMessageRow";
import type { AsyncButtonHandle, AsyncResult } from "../components/ui/AsyncButton";
import { AnchorTopScrollArea } from "../components/ui/AnchorTopScrollArea";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { ChatSessionContext, useThoughtExpandedStageState } from "../hooks/chatSessionContext";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import { isThoughtStreamEntry, type ChatAttachment } from "../protocol/chatEntry";
import type { LlmRef } from "../../../backend/src/contracts/llm";

async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
  llm: LlmRef | null,
  modelPresetId: number | null,
  attachments: PostMessageAttachment[],
  parentId: string | null,
  clientRequestId: string,
): Promise<AsyncResult> {
  const { status } = await postConversationMessage(conversationId, {
    message,
    agentId,
    ...(llm ? { llm } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    parentId,
    clientRequestId,
  });
  return { ok: status >= 200 && status < 300 };
}

/**
 * Default delivery mode for a freshly-picked file.
 *
 * Heuristic: anything likely to be small + meaningful as-is to the model
 * (image, plain text) defaults to `direct`. Larger / opaque files
 * (PDFs, archives, big binaries) default to `summary` so the planner
 * isn't blasted with raw bytes on every turn. User can flip per file.
 */
function defaultAttachmentMode(file: File): AttachmentMode {
  if (file.type.startsWith("image/")) return "direct";
  if (file.type.startsWith("text/")) return "direct";
  return "summary";
}

type ChatPageProps = {
  conversationId: string | null;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  rightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  settingsPressed?: boolean;
};

export function ChatPage({
  conversationId,
  sidebarVisible,
  onToggleSidebar,
  rightSidebarVisible,
  onToggleRightSidebar,
  terminalVisible,
  onToggleTerminal,
  onOpenSettings,
  settingsPressed = false,
}: ChatPageProps) {
  const composerTextareaRef = useFocusOnFirstFrame<HTMLTextAreaElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendButtonRef = useRef<AsyncButtonHandle>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<SelectedAttachment[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [topAnchorEntryId, setTopAnchorEntryId] = useState<string | null>(null);
  const [selectedBranchAnchorEntryId, setSelectedBranchAnchorEntryId] = useState<string | null>(null);
  const [agentSelection, setAgentSelection] = useState<ChatAgentSelection>(() => ({
    agentId: agentIdFromSearchParams(searchParams) || "",
    llm: null,
    modelPresetId: null,
  }));

  const onAgentSelectionChange = useCallback((selection: ChatAgentSelection) => {
    setAgentSelection(selection);
  }, []);

  const { activePathEntries: chatEntries, allEntries, activeLeafId, setActiveLeaf, appendOptimisticUserMessage } =
    useChatSession(conversationId);
  const { expandedStageBySlotKey, setSlotExpandedStage } = useThoughtExpandedStageState();
  const chatSessionContextValue = useMemo(
    () => ({
      conversationId,
      activePathEntries: chatEntries,
      allEntries,
      activeLeafId,
      setActiveLeaf,
      expandedStageBySlotKey,
      setSlotExpandedStage,
    }),
    [conversationId, chatEntries, allEntries, activeLeafId, setActiveLeaf, expandedStageBySlotKey, setSlotExpandedStage],
  );
  const activePathEntries = chatEntries.map((entry$) => entry$.get());
  const activePathEntryById = useMemo(() => new Map(activePathEntries.map((entry) => [entry.id, entry])), [activePathEntries]);
  const tripletStreamIdByThoughtId = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of activePathEntries) {
      if (isThoughtStreamEntry(entry)) {
        map.set(entry.thoughtId, entry.id);
      }
    }
    return map;
  }, [activePathEntries]);
  const thoughtTripletsById = new Map<string, ThoughtTripletRefs>();
  for (const entry$ of chatEntries) {
    const entry = entry$.get();
    if (isThoughtStreamEntry(entry)) {
      const current = thoughtTripletsById.get(entry.thoughtId) ?? {};
      current.streamEntry$ = entry$;
      thoughtTripletsById.set(entry.thoughtId, current);
    } else if (entry.type === "thought-action") {
      const current = thoughtTripletsById.get(entry.thoughtId) ?? {};
      current.actionEntry = entry;
      thoughtTripletsById.set(entry.thoughtId, current);
    }
  }
  // Filter out stream + action entries so each thought is rendered exactly once,
  // anchored at its thought-prepare slot. This makes chat order follow
  // thought-start order even if subsequent stream/action appends race.
  const visibleEntries = chatEntries.filter((entry$) => {
    const entry = entry$.get();
    return !isThoughtStreamEntry(entry) && entry.type !== "thought-action";
  });
  const resolveVisibleAnchorEntryId = useCallback(
    (entryId: string): string => {
      const selected = activePathEntryById.get(entryId);
      if (!selected) return entryId;
      if (selected.type !== "thought-prepare" && selected.type !== "thought-action") {
        return entryId;
      }
      return tripletStreamIdByThoughtId.get(selected.thoughtId) ?? entryId;
    },
    [activePathEntryById, tripletStreamIdByThoughtId],
  );
  const canSend = input.trim().length > 0 || selectedFiles.length > 0;

  useEffect(() => {
    const id = requestAnimationFrame(() => composerTextareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [conversationId, composerTextareaRef]);

  useEffect(() => {
    const urls = selectedFiles.map(({ file }) =>
      file.type.startsWith("image/") || file.type === "application/pdf" ? URL.createObjectURL(file) : "",
    );
    setPreviewUrls(urls);
    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [selectedFiles]);

  useEffect(() => {
    if (!conversationId || chatEntries.length === 0) {
      setTopAnchorEntryId(null);
      setSelectedBranchAnchorEntryId(null);
      return;
    }
    if (selectedBranchAnchorEntryId) {
      const existsInActivePath = chatEntries.some((row$) => row$.id === selectedBranchAnchorEntryId);
      if (existsInActivePath) {
        setTopAnchorEntryId(selectedBranchAnchorEntryId);
        return;
      }
      setSelectedBranchAnchorEntryId(null);
    }
    for (let i = chatEntries.length - 1; i >= 0; i -= 1) {
      const row = chatEntries[i].get();
      if (row.type === "user-message") {
        setTopAnchorEntryId(row.id);
        return;
      }
    }
    setTopAnchorEntryId(null);
  }, [conversationId, chatEntries, selectedBranchAnchorEntryId]);

  const composer = (
    <MessageComposer
      textareaRef={composerTextareaRef}
      sendButtonRef={sendButtonRef}
      value={input}
      onValueChange={setInput}
      onPaste={(e) => {
        const items = Array.from(e.clipboardData?.items ?? []);
        const images: SelectedAttachment[] = [];
        for (const item of items) {
          if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
          const file = item.getAsFile();
          if (file) images.push({ file, mode: defaultAttachmentMode(file) });
        }
        if (images.length > 0) {
          setSelectedFiles((prev) => [...prev, ...images]);
        }
      }}
      fileInputRef={fileInputRef}
      onFileInputChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        if (files.length === 0) return;
        const wrapped: SelectedAttachment[] = files.map((file) => ({ file, mode: defaultAttachmentMode(file) }));
        setSelectedFiles((prev) => [...prev, ...wrapped]);
        e.currentTarget.value = "";
      }}
      onPickFiles={() => fileInputRef.current?.click()}
      canSend={canSend}
      placeholder="Send a message…"
      selectionSlot={<ChatAgentToolbar onSelectionChange={onAgentSelectionChange} embedded />}
      attachmentsSlot={
        selectedFiles.length > 0 ? (
          <AttachmentChips
            files={selectedFiles}
            previewUrls={previewUrls}
            onChangeMode={(idx, next) =>
              setSelectedFiles((prev) => prev.map((entry, x) => (x === idx ? { ...entry, mode: next } : entry)))
            }
            onRemove={(idx) => setSelectedFiles((prev) => prev.filter((_, x) => x !== idx))}
          />
        ) : undefined
      }
      onSendAsync={() => {
        return (async () => {
          const text = input.trim();
          if (!text && selectedFiles.length === 0) return { ok: false };
          const uploadedAttachments: ChatAttachment[] = [];
          for (const { file, mode } of selectedFiles) {
            const uploaded = await uploadFile(file);
            uploadedAttachments.push({ ...uploaded.attachment, mode });
          }
          let cid = conversationId;
          const parentLeafIdAtSend = cid ? activeLeafId : null;
          const optimisticInput = {
            text,
            agentId: agentSelection.agentId,
            modelPresetId: agentSelection.modelPresetId,
            ...(agentSelection.llm ? { llm: agentSelection.llm } : {}),
            attachments: uploadedAttachments,
          };
          let optimistic: { rowId: string; clientRequestId: string } | null;
          if (!cid) {
            const created = await createConversation();
            cid = created.id;
            optimistic = appendOptimisticUserMessage({ conversationId: cid, ...optimisticInput });
            const q = searchParams.toString();
            navigate(
              {
                pathname: `/chat/${encodeURIComponent(cid)}`,
                search: q ? `?${q}` : "",
              },
              { replace: true },
            );
          } else {
            optimistic = appendOptimisticUserMessage({ conversationId: cid, ...optimisticInput });
          }
          if (!optimistic) return { ok: false };
          setSelectedBranchAnchorEntryId(null);
          setTopAnchorEntryId(optimistic.rowId);
          setInput("");
          setSelectedFiles([]);
          return sendMessageToConversation(
            cid,
            text,
            agentSelection.agentId,
            agentSelection.llm,
            agentSelection.modelPresetId,
            uploadedAttachments.map((x) => ({ id: x.id, mode: x.mode })),
            parentLeafIdAtSend,
            optimistic.clientRequestId,
          );
        })();
      }}
    />
  );

  const chatPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* important to not add any padding to the content here */}
        <AnchorTopScrollArea
          className={cn("scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden")}
          topAnchorEntryId={topAnchorEntryId}
        >
          {conversationId
            ? visibleEntries.map((entry$) => {
                const entry = entry$.get();
                return (
                  <div key={messageRowKey(entry$)} data-chat-entry-id={entry.id} data-chat-entry-type={entry.type}>
                    <ChatMessageRow entry$={entry$} conversationId={conversationId} thoughtTripletsById={thoughtTripletsById} />
                  </div>
                );
              })
            : null}
        </AnchorTopScrollArea>
      </main>
      {composer}
    </div>
  );

  const chatAndTerminal = terminalVisible ? (
    <ResizablePanelGroup direction="vertical" autoSaveId="chat-terminal-layout" className="min-h-0 min-w-0 flex-1">
      <ResizablePanel minSize={20} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {chatPane}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={30} minSize={15} maxSize={70} className="min-h-0 min-w-0 overflow-hidden border-t border-border">
        <TerminalPanel className="h-full w-full" />
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : chatPane;

  return (
    <ChatSessionContext.Provider value={chatSessionContextValue}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatTitlePanel
        conversationId={conversationId}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={onToggleSidebar}
        rightSidebarVisible={rightSidebarVisible}
        onToggleRightSidebar={onToggleRightSidebar}
        terminalVisible={terminalVisible}
        onToggleTerminal={onToggleTerminal}
        onOpenSettings={onOpenSettings}
        settingsPressed={settingsPressed}
      />
      {/* Main area: horizontal split when right sidebar open */}
      {rightSidebarVisible ? (
        <ResizablePanelGroup direction="horizontal" autoSaveId="chat-right-branches-layout" className="min-h-0 min-w-0 flex-1">
          <ResizablePanel minSize={30} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {chatAndTerminal}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={26} minSize={16} maxSize={45} className="min-h-0 min-w-0 overflow-hidden">
            <aside className="min-h-0 min-w-0 h-full overflow-y-auto border-l border-border bg-sidebar">
              <ConversationBranchesPanel
                onAnchorEntrySelected={(entryId) => {
                  const visibleAnchorId = resolveVisibleAnchorEntryId(entryId);
                  setSelectedBranchAnchorEntryId(visibleAnchorId);
                  setTopAnchorEntryId(visibleAnchorId);
                }}
              />
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {chatAndTerminal}
        </div>
      )}
    </div>
    </ChatSessionContext.Provider>
  );
}
