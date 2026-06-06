import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  agentIdFromSearchParams,
  type ChatAgentSelection,
} from "../components/chat/ChatAgentToolbar";
import { ChatTitlePanel } from "../components/chat/header/ChatTitlePanel";
import { ConversationBranchesPanel } from "../components/chat/ConversationBranchesPanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { ChatComposer } from "../components/chat/ChatComposer";
import { type SelectedAttachment } from "../components/chat/AttachmentChips";
import { ChatMessageRow, messageRowKey, type ThoughtTripletRefs } from "../components/chat/ChatMessageRow";
import { AgentCardsEmptyState } from "../components/chat/AgentCardsEmptyState";
import { Spinner } from "../components/ui/Spinner";
import { AnchorTopScrollArea } from "../components/ui/AnchorTopScrollArea";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { ChatSessionContext, useThoughtExpandedStageState } from "../hooks/chatSessionContext";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import { useTasks } from "../hooks/useTasks";
import { isThoughtStreamEntry } from "../protocol/chatEntry";

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
  const [searchParams] = useSearchParams();
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

  const {
    sessionStore,
    activePathEntries: chatEntries,
    allEntries,
    isSessionLoading,
    setActiveLeaf,
    switchToBranch,
    appendOptimisticUserMessage,
  } = useChatSession(conversationId);
  const { tasks } = useTasks();
  const steerOnSend = useMemo(
    () =>
      Boolean(
        conversationId &&
          tasks.some((task) => task.conversationId === conversationId && task.status === "running"),
      ),
    [conversationId, tasks],
  );
  const { expandedStageBySlotKey, setSlotExpandedStage, resetExpandedStages } = useThoughtExpandedStageState();
  const chatSessionContextValue = useMemo(
    () => ({
      conversationId,
      sessionStore,
      activePathEntries: chatEntries,
      allEntries,
      setActiveLeaf,
      switchToBranch,
      expandedStageBySlotKey,
      setSlotExpandedStage,
    }),
    [conversationId, sessionStore, chatEntries, allEntries, setActiveLeaf, switchToBranch, expandedStageBySlotKey, setSlotExpandedStage],
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
    setInput("");
    setSelectedFiles([]);
    setTopAnchorEntryId(null);
    setSelectedBranchAnchorEntryId(null);
    resetExpandedStages();
  }, [conversationId, resetExpandedStages]);

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

  const handleSent = useCallback((optimisticRowId: string) => {
    setSelectedBranchAnchorEntryId(null);
    setTopAnchorEntryId(optimisticRowId);
  }, []);

  const chatPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AnchorTopScrollArea
          data-testid="chat-transcript"
          className={cn("scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden")}
          topAnchorEntryId={topAnchorEntryId}
        >
          {conversationId && visibleEntries.length > 0
            ? visibleEntries.map((entry$) => {
                const entry = entry$.get();
                return (
                  <div
                    key={messageRowKey(entry$)}
                    data-chat-entry-id={entry.id}
                    data-chat-entry-type={entry.type}
                    {...(entry.type === "thought-prepare"
                      ? { "data-chat-prepare-title": entry.title ?? "" }
                      : {})}
                  >
                    <ChatMessageRow entry$={entry$} conversationId={conversationId} thoughtTripletsById={thoughtTripletsById} />
                  </div>
                );
              })
            : conversationId && isSessionLoading && visibleEntries.length === 0
              ? (
                <div
                  data-testid="chat-loading"
                  className="flex min-h-[12rem] flex-1 items-center justify-center p-8 text-muted-foreground"
                >
                  <Spinner size={16} />
                </div>
              )
              : <AgentCardsEmptyState selectedAgentId={agentSelection.agentId} />}
        </AnchorTopScrollArea>
      </main>
      <ChatComposer
        conversationId={conversationId}
        composerTextareaRef={composerTextareaRef}
        input={input}
        setInput={setInput}
        selectedFiles={selectedFiles}
        setSelectedFiles={setSelectedFiles}
        previewUrls={previewUrls}
        agentSelection={agentSelection}
        onAgentSelectionChange={onAgentSelectionChange}
        canSend={canSend}
        appendOptimisticUserMessage={appendOptimisticUserMessage}
        onSent={handleSent}
        steerOnSend={steerOnSend}
      />
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
