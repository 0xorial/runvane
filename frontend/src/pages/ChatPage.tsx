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
import { ChatMessageRow, messageRowKey } from "../components/chat/ChatMessageRow";
import { ThoughtTripletRow } from "../components/chat/rows/ThoughtTripletRow";
import type { AsyncButtonHandle, AsyncResult } from "../components/ui/AsyncButton";
import { AnchorTopScrollArea } from "../components/ui/AnchorTopScrollArea";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import type { ChatAttachment } from "../protocol/chatEntry";
import type {
  ChatEntry,
  PlannerLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
} from "../protocol/chatEntry";

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

  const { chatEntries, appendOptimisticUserMessage } = useChatSession(conversationId);
  const activePathEntries = chatEntries.map((entry$) => entry$.get());
  const canSend = input.trim().length > 0 || selectedFiles.length > 0;

  const renderedRows = useMemo<
    Array<
      | { kind: "single"; entry$: (typeof chatEntries)[number] }
      | {
          kind: "triplet";
          thoughtId: string;
          prepare: ThoughtPrepareEntry;
          queried: PlannerLlmStreamEntry | TitleLlmStreamEntry;
          action: ThoughtActionEntry;
          anchorIds: string[];
        }
    >
  >(() => {
    const isThoughtStepEntry = (entry: ChatEntry): boolean =>
      entry.type === "thought-prepare" ||
      entry.type === "planner_llm_stream" ||
      entry.type === "title_llm_stream" ||
      entry.type === "thought-action";

    const entries = chatEntries.map((entry$) => entry$.get());
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const childrenByParent = new Map<string | null, ChatEntry[]>();
    for (const entry of entries) {
      const list = childrenByParent.get(entry.parentId) ?? [];
      list.push(entry);
      childrenByParent.set(entry.parentId, list);
    }
    for (const list of childrenByParent.values()) {
      list.sort((a, b) =>
        a.conversationIndex !== b.conversationIndex ? a.conversationIndex - b.conversationIndex : a.createdAt.localeCompare(b.createdAt),
      );
    }

    const tripletByEntryId = new Map<
      string,
      {
        tripletId: string;
        firstEntryId: string;
        prepare: ThoughtPrepareEntry;
        queried: PlannerLlmStreamEntry | TitleLlmStreamEntry;
        action: ThoughtActionEntry;
      }
    >();

    for (const queried of entries) {
      if (queried.type !== "planner_llm_stream" && queried.type !== "title_llm_stream") continue;
      const parent = queried.parentId ? entryById.get(queried.parentId) : null;
      if (!parent || parent.type !== "thought-prepare") continue;
      const action = (childrenByParent.get(queried.id) ?? []).find((x): x is ThoughtActionEntry => x.type === "thought-action");
      if (!action) continue;

      const thoughtId =
        queried.thoughtId && parent.thoughtId === queried.thoughtId && action.thoughtId === queried.thoughtId
          ? queried.thoughtId
          : `legacy-${queried.id}`;
      const firstEntryId =
        [parent, queried, action].sort((a, b) =>
          a.conversationIndex !== b.conversationIndex ? a.conversationIndex - b.conversationIndex : a.createdAt.localeCompare(b.createdAt),
        )[0].id;
      const triplet = { tripletId: thoughtId, firstEntryId, prepare: parent, queried, action };
      tripletByEntryId.set(parent.id, triplet);
      tripletByEntryId.set(queried.id, triplet);
      tripletByEntryId.set(action.id, triplet);
    }

    const rows: Array<
      | { kind: "single"; entry$: (typeof chatEntries)[number] }
      | {
          kind: "triplet";
          thoughtId: string;
          prepare: ThoughtPrepareEntry;
          queried: PlannerLlmStreamEntry | TitleLlmStreamEntry;
          action: ThoughtActionEntry;
          anchorIds: string[];
        }
    > = [];

    for (const entry$ of chatEntries) {
      const entry = entry$.get();
      const triplet = tripletByEntryId.get(entry.id);
      if (!triplet) {
        if (isThoughtStepEntry(entry)) continue;
        rows.push({ kind: "single", entry$ });
        continue;
      }
      if (entry.id !== triplet.firstEntryId) continue;
      rows.push({
        kind: "triplet",
        thoughtId: triplet.tripletId,
        prepare: triplet.prepare,
        queried: triplet.queried,
        action: triplet.action,
        anchorIds: [triplet.prepare.id, triplet.queried.id, triplet.action.id],
      });
    }
    return rows;
  }, [chatEntries]);

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
                {renderedRows.map((row) => {
                  if (row.kind === "single") {
                    const entry = row.entry$.get();
                    return (
                      <div key={messageRowKey(row.entry$)} data-chat-entry-id={entry.id} data-chat-entry-type={entry.type}>
                        <ChatMessageRow entry$={row.entry$} />
                      </div>
                    );
                  }
                  return (
                    <div key={`thought-${row.thoughtId}`} data-chat-entry-id={row.queried.id} data-chat-entry-type={row.queried.type}>
                      {row.anchorIds.map((anchorId) =>
                        anchorId === row.queried.id ? null : (
                          <div key={anchorId} data-chat-entry-id={anchorId} className="h-0 overflow-hidden" aria-hidden />
                        ),
                      )}
                      <ThoughtTripletRow
                        prepare={row.prepare}
                        queried={row.queried}
                        action={row.action}
                        conversationId={conversationId}
                      />
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
                conversationId={conversationId}
                activePathEntries={activePathEntries}
                onAnchorEntrySelected={(entryId) => {
                  setSelectedBranchAnchorEntryId(entryId);
                  setTopAnchorEntryId(entryId);
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
              {renderedRows.map((row) => {
                if (row.kind === "single") {
                  const entry = row.entry$.get();
                  return (
                    <div key={messageRowKey(row.entry$)} data-chat-entry-id={entry.id} data-chat-entry-type={entry.type}>
                      <ChatMessageRow entry$={row.entry$} />
                    </div>
                  );
                }
                return (
                  <div key={`thought-${row.thoughtId}`} data-chat-entry-id={row.queried.id} data-chat-entry-type={row.queried.type}>
                    {row.anchorIds.map((anchorId) =>
                      anchorId === row.queried.id ? null : (
                        <div key={anchorId} data-chat-entry-id={anchorId} className="h-0 overflow-hidden" aria-hidden />
                      ),
                    )}
                    <ThoughtTripletRow
                      prepare={row.prepare}
                      queried={row.queried}
                      action={row.action}
                      conversationId={conversationId}
                    />
                  </div>
                );
              })}
            </AnchorTopScrollArea>
          </main>
          {composer}
        </div>
      )}
    </div>
  );
}
