import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { createConversation, postConversationMessage, uploadFile } from "../api/client";
import {
  agentIdFromSearchParams,
  ChatAgentToolbar,
  type ChatAgentSelection,
} from "../components/chat/ChatAgentToolbar";
import { ChatTitlePanel } from "../components/chat/header/ChatTitlePanel";
import { ConversationBranchesPanel } from "../components/chat/ConversationBranchesPanel";
import { MessageComposer } from "../components/chat/MessageComposer";
import { ChatMessageRow, messageRowKey, type ThoughtTripletRefs } from "../components/chat/ChatMessageRow";
import type { AsyncButtonHandle, AsyncResult } from "../components/ui/AsyncButton";
import { AnchorTopScrollArea } from "../components/ui/AnchorTopScrollArea";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { ChatSessionContext, useThoughtExpandedStageState } from "../hooks/chatSessionContext";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import { isThoughtStreamEntry, type ChatAttachment } from "../protocol/chatEntry";

async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
  llmProviderId: string,
  llmModel: string,
  modelPresetId: number | null,
  attachmentIds: string[],
): Promise<AsyncResult> {
  const { status } = await postConversationMessage(conversationId, {
    message,
    agentId,
    ...(llmProviderId.trim() ? { llmProviderId: llmProviderId.trim() } : {}),
    ...(llmModel.trim() ? { llmModel: llmModel.trim() } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  });
  return { ok: status === 200 || status === 202 };
}

type ChatPageProps = {
  conversationId: string | null;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  rightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
  onOpenSettings: () => void;
  settingsPressed?: boolean;
};

export function ChatPage({
  conversationId,
  sidebarVisible,
  onToggleSidebar,
  rightSidebarVisible,
  onToggleRightSidebar,
  onOpenSettings,
  settingsPressed = false,
}: ChatPageProps) {
  const composerTextareaRef = useFocusOnFirstFrame<HTMLTextAreaElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendButtonRef = useRef<AsyncButtonHandle>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [topAnchorEntryId, setTopAnchorEntryId] = useState<string | null>(null);
  const [selectedBranchAnchorEntryId, setSelectedBranchAnchorEntryId] = useState<string | null>(null);
  const [agentSelection, setAgentSelection] = useState<ChatAgentSelection>(() => ({
    agentId: agentIdFromSearchParams(searchParams) || "",
    llmProviderId: "",
    llmModel: "",
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
    if (!isThoughtStreamEntry(entry) && entry.type !== "thought-prepare" && entry.type !== "thought-action") {
      continue;
    }
    const current = thoughtTripletsById.get(entry.thoughtId) ?? {};
    if (entry.type === "thought-prepare") {
      current.prepareEntry = entry;
    } else if (entry.type === "thought-action") {
      current.actionEntry = entry;
    }
    thoughtTripletsById.set(entry.thoughtId, current);
  }
  const visibleEntries = chatEntries.filter((entry$) => {
    const entry = entry$.get();
    return entry.type !== "thought-prepare" && entry.type !== "thought-action";
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
    const urls = selectedFiles.map((file) =>
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
        const images: File[] = [];
        for (const item of items) {
          if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
          const file = item.getAsFile();
          if (file) images.push(file);
        }
        if (images.length > 0) {
          setSelectedFiles((prev) => [...prev, ...images]);
        }
      }}
      fileInputRef={fileInputRef}
      onFileInputChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        if (files.length === 0) return;
        setSelectedFiles((prev) => [...prev, ...files]);
        e.currentTarget.value = "";
      }}
      onPickFiles={() => fileInputRef.current?.click()}
      canSend={canSend}
      placeholder="Send a message…"
      selectionSlot={<ChatAgentToolbar onSelectionChange={onAgentSelectionChange} embedded />}
      attachmentsSlot={
        selectedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedFiles.map((file, idx) => (
              <button
                key={`${file.name}-${file.size}-${idx}`}
                type="button"
                className="flex w-[120px] flex-col gap-1 rounded-md border border-border bg-card p-1.5 text-left text-card-foreground"
                onClick={() => setSelectedFiles((prev) => prev.filter((_, x) => x !== idx))}
                title="Remove file"
              >
                {previewUrls[idx] ? (
                  file.type === "application/pdf" ? (
                    <iframe className="h-[76px] w-full rounded-md border-0 bg-muted" src={previewUrls[idx]} title={file.name} />
                  ) : (
                    <img className="h-[76px] w-full rounded-md object-cover" src={previewUrls[idx]} alt={file.name} />
                  )
                ) : (
                  <div className="flex h-[76px] w-full items-center justify-center rounded-md bg-muted text-[11px] font-bold tracking-wide text-muted-foreground">
                    FILE
                  </div>
                )}
                <div className="break-words text-xs leading-tight">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">Remove</div>
              </button>
            ))}
          </div>
        ) : undefined
      }
      onSendAsync={() => {
        return (async () => {
          const text = input.trim();
          if (!text && selectedFiles.length === 0) return { ok: false };
          const uploadedAttachments: ChatAttachment[] = [];
          for (const file of selectedFiles) {
            const uploaded = await uploadFile(file);
            uploadedAttachments.push(uploaded.attachment);
          }
          let cid = conversationId;
          if (!cid) {
            const created = await createConversation();
            cid = created.id;
            const rowId = appendOptimisticUserMessage({
              conversationId: cid,
              text,
              agentId: agentSelection.agentId,
              llmProviderId: agentSelection.llmProviderId,
              llmModel: agentSelection.llmModel,
              modelPresetId: agentSelection.modelPresetId,
              attachments: uploadedAttachments,
            });
            setSelectedBranchAnchorEntryId(null);
            setTopAnchorEntryId(rowId);
            const q = searchParams.toString();
            navigate(
              {
                pathname: `/chat/${encodeURIComponent(cid)}`,
                search: q ? `?${q}` : "",
              },
              { replace: true },
            );
          } else {
            const rowId = appendOptimisticUserMessage({
              conversationId: cid,
              text,
              agentId: agentSelection.agentId,
              llmProviderId: agentSelection.llmProviderId,
              llmModel: agentSelection.llmModel,
              modelPresetId: agentSelection.modelPresetId,
              attachments: uploadedAttachments,
            });
            setSelectedBranchAnchorEntryId(null);
            setTopAnchorEntryId(rowId);
          }
          setInput("");
          setSelectedFiles([]);
          return sendMessageToConversation(
            cid,
            text,
            agentSelection.agentId,
            agentSelection.llmProviderId,
            agentSelection.llmModel,
            agentSelection.modelPresetId,
            uploadedAttachments.map((x) => x.id),
          );
        })();
      }}
    />
  );

  return (
    <ChatSessionContext.Provider value={chatSessionContextValue}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatTitlePanel
        conversationId={conversationId}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={onToggleSidebar}
        rightSidebarVisible={rightSidebarVisible}
        onToggleRightSidebar={onToggleRightSidebar}
        onOpenSettings={onOpenSettings}
        settingsPressed={settingsPressed}
      />
      {rightSidebarVisible ? (
        <ResizablePanelGroup direction="horizontal" autoSaveId="chat-right-branches-layout" className="min-h-0 min-w-0 flex-1">
          <ResizablePanel minSize={40} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* important to not add any padding to the content here */}
              <AnchorTopScrollArea
                className={cn("scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden")}
                topAnchorEntryId={topAnchorEntryId}
              >
                {visibleEntries.map((entry$) => {
                  const entry = entry$.get();
                  return (
                    <div key={messageRowKey(entry$)} data-chat-entry-id={entry.id} data-chat-entry-type={entry.type}>
                      <ChatMessageRow entry$={entry$} conversationId={conversationId} thoughtTripletsById={thoughtTripletsById} />
                    </div>
                  );
                })}
              </AnchorTopScrollArea>
            </main>
            {composer}
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
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* important to not add any padding to the content here */}
            <AnchorTopScrollArea
              className={cn("scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden")}
              topAnchorEntryId={topAnchorEntryId}
            >
              {visibleEntries.map((entry$) => {
                const entry = entry$.get();
                return (
                  <div key={messageRowKey(entry$)} data-chat-entry-id={entry.id} data-chat-entry-type={entry.type}>
                    <ChatMessageRow entry$={entry$} conversationId={conversationId} thoughtTripletsById={thoughtTripletsById} />
                  </div>
                );
              })}
            </AnchorTopScrollArea>
          </main>
          {composer}
        </div>
      )}
    </div>
    </ChatSessionContext.Provider>
  );
}
