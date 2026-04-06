import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { createConversation, postConversationMessage, uploadFile } from "../api/client";
import {
  agentIdFromSearchParams,
  ChatAgentToolbar,
  type ChatAgentSelection,
} from "../components/chat/ChatAgentToolbar";
import { MessageComposer } from "../components/chat/MessageComposer";
import {
  ChatMessageRow,
  messageRowKey,
} from "../components/chat/ChatMessageRow";
import type { AsyncButtonHandle, AsyncResult } from "../components/ui/AsyncButton";
import { StickToBottomScrollArea } from "../components/ui/StickToBottomScrollArea";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import type { ChatAttachment } from "../protocol/chatEntry";

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
    agent_id: agentId,
    ...(llmProviderId.trim() ? { llm_provider_id: llmProviderId.trim() } : {}),
    ...(llmModel.trim() ? { llm_model: llmModel.trim() } : {}),
    ...(modelPresetId != null ? { model_preset_id: modelPresetId } : {}),
    ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
  });
  return { ok: status === 200 || status === 202 };
}

type ChatPageProps = {
  conversationId: string | null;
};

export function ChatPage({ conversationId }: ChatPageProps) {
  const composerTextareaRef = useFocusOnFirstFrame<HTMLTextAreaElement>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendButtonRef = useRef<AsyncButtonHandle>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [agentSelection, setAgentSelection] = useState<ChatAgentSelection>(
    () => ({
      agentId: agentIdFromSearchParams(searchParams) || "",
      llmProviderId: "",
      llmModel: "",
      modelPresetId: null,
    }),
  );

  const onAgentSelectionChange = useCallback(
    (selection: ChatAgentSelection) => {
      setAgentSelection(selection);
    },
    [],
  );

  const { chatEntries, appendOptimisticUserMessage } = useChatSession(conversationId);
  const canSend = input.trim().length > 0 || selectedFiles.length > 0;

  useEffect(() => {
    const id = requestAnimationFrame(() => composerTextareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [conversationId, composerTextareaRef]);

  useEffect(() => {
    const urls = selectedFiles.map((file) =>
      file.type.startsWith("image/") || file.type === "application/pdf"
        ? URL.createObjectURL(file)
        : "",
    );
    setPreviewUrls(urls);
    return () => {
      urls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [selectedFiles]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatAgentToolbar onSelectionChange={onAgentSelectionChange} />
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <StickToBottomScrollArea
            className={cn(
              "scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden px-2 py-2",
            )}
          >
            {chatEntries.map((entry$) => (
              <ChatMessageRow key={messageRowKey(entry$)} entry$={entry$} />
            ))}
          </StickToBottomScrollArea>
        </main>
      </div>
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
        attachmentsSlot={
          selectedFiles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedFiles.map((file, idx) => (
                <button
                  key={`${file.name}-${file.size}-${idx}`}
                  type="button"
                  className="flex w-[120px] flex-col gap-1 rounded-md border border-border bg-card p-1.5 text-left text-card-foreground"
                  onClick={() =>
                    setSelectedFiles((prev) => prev.filter((_, x) => x !== idx))
                  }
                  title="Remove file"
                >
                  {previewUrls[idx] ? (
                    file.type === "application/pdf" ? (
                      <iframe
                        className="h-[76px] w-full rounded-md border-0 bg-muted"
                        src={previewUrls[idx]}
                        title={file.name}
                      />
                    ) : (
                      <img
                        className="h-[76px] w-full rounded-md object-cover"
                        src={previewUrls[idx]}
                        alt={file.name}
                      />
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
              appendOptimisticUserMessage({
                conversationId: cid,
                text,
                agentId: agentSelection.agentId,
                llmProviderId: agentSelection.llmProviderId,
                llmModel: agentSelection.llmModel,
                modelPresetId: agentSelection.modelPresetId,
                attachments: uploadedAttachments,
              });
              const q = searchParams.toString();
              navigate(
                {
                  pathname: `/chat/${encodeURIComponent(cid)}`,
                  search: q ? `?${q}` : "",
                },
                { replace: true },
              );
            } else {
              appendOptimisticUserMessage({
                conversationId: cid,
                text,
                agentId: agentSelection.agentId,
                llmProviderId: agentSelection.llmProviderId,
                llmModel: agentSelection.llmModel,
                modelPresetId: agentSelection.modelPresetId,
                attachments: uploadedAttachments,
              });
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
    </div>
  );
}
