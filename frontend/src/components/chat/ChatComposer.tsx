import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MessageSendMode } from "./MessageComposer";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createConversation, uploadFile } from "../../api/client";
import type { ChatAttachment } from "../../protocol/chatEntry";
import type { LlmRef } from "../../../../backend/src/contracts/llm";
import { ChatAgentToolbar, type ChatAgentSelection } from "./ChatAgentToolbar";
import { AttachmentChips, type SelectedAttachment } from "./AttachmentChips";
import { MessageComposer } from "./MessageComposer";
import { defaultAttachmentMode, sendMessageToConversation } from "./sendMessage";

type ChatComposerProps = {
  conversationId: string | null;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: string) => void;
  selectedFiles: SelectedAttachment[];
  setSelectedFiles: Dispatch<SetStateAction<SelectedAttachment[]>>;
  previewUrls: string[];
  agentSelection: ChatAgentSelection;
  onAgentSelectionChange: (selection: ChatAgentSelection) => void;
  canSend: boolean;
  appendOptimisticUserMessage: (args: {
    conversationId: string;
    text: string;
    agentId: string;
    modelPresetId: number | null;
    llm?: LlmRef;
    attachments: ChatAttachment[];
  }) => { rowId: string; clientRequestId: string; parentId: string | null } | null;
  onSent: (optimisticRowId: string) => void;
  agentRunning?: boolean;
};

export function ChatComposer({
  conversationId,
  composerTextareaRef,
  input,
  setInput,
  selectedFiles,
  setSelectedFiles,
  previewUrls,
  agentSelection,
  onAgentSelectionChange,
  canSend,
  appendOptimisticUserMessage,
  onSent,
  agentRunning = false,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  return (
    <MessageComposer
      textareaRef={composerTextareaRef}
      agentRunning={agentRunning}
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
      onSendAsync={({ steer }: MessageSendMode) => {
        return (async () => {
          const text = input.trim();
          if (!text && selectedFiles.length === 0) return { ok: false };
          const uploadedAttachments: ChatAttachment[] = [];
          for (const { file, mode } of selectedFiles) {
            const uploaded = await uploadFile(file);
            uploadedAttachments.push({ ...uploaded.attachment, mode });
          }
          const optimisticInput = {
            text,
            agentId: agentSelection.agentId,
            modelPresetId: agentSelection.modelPresetId,
            ...(agentSelection.llm ? { llm: agentSelection.llm } : {}),
            attachments: uploadedAttachments,
          };
          if (!conversationId) {
            const created = await createConversation();
            const cid = created.id;
            setInput("");
            setSelectedFiles([]);
            const result = await sendMessageToConversation(
              cid,
              text,
              agentSelection.agentId,
              agentSelection.llm,
              agentSelection.modelPresetId,
              uploadedAttachments.map((x) => ({ id: x.id, mode: x.mode })),
              null,
              crypto.randomUUID(),
              steer,
            );
            const q = searchParams.toString();
            navigate(
              {
                pathname: `/chat/${encodeURIComponent(cid)}`,
                search: q ? `?${q}` : "",
              },
              { replace: true },
            );
            return result;
          }

          const optimistic = appendOptimisticUserMessage({ conversationId, ...optimisticInput });
          if (!optimistic) return { ok: false };
          onSent(optimistic.rowId);
          setInput("");
          setSelectedFiles([]);
          return sendMessageToConversation(
            conversationId,
            text,
            agentSelection.agentId,
            agentSelection.llm,
            agentSelection.modelPresetId,
            uploadedAttachments.map((x) => ({ id: x.id, mode: x.mode })),
            optimistic.parentId,
            optimistic.clientRequestId,
            steer,
          );
        })();
      }}
    />
  );
}
