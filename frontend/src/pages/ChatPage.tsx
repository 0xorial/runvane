import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  agentIdFromSearchParams,
  ChatAgentToolbar,
  type ChatAgentSelection,
} from "../components/chat/ChatAgentToolbar";
import {
  ChatMessageRow,
  messageRowKey,
} from "../components/chat/ChatMessageRow";
import { createConversation, postConversationMessage, uploadFile } from "../api/client";
import {
  AsyncButton,
  type AsyncButtonHandle,
  type AsyncResult,
} from "../components/ui/AsyncButton";
import { StickToBottomScrollArea } from "../components/ui/StickToBottomScrollArea";
import { useChatSession } from "../hooks/useChatSession";
import { useFocusOnFirstFrame } from "../hooks/useFocusOnFirstFrame";
import type { ChatAttachment } from "../protocol/chatEntry";
import styles from "./ChatPage.module.css";

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
  const composerInputRef = useFocusOnFirstFrame<HTMLInputElement>();
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
    })
  );

  const onAgentSelectionChange = useCallback(
    (selection: ChatAgentSelection) => {
      setAgentSelection(selection);
    },
    []
  );

  const { chatEntries, appendOptimisticUserMessage } = useChatSession(conversationId);
  const canSend = input.trim().length > 0 || selectedFiles.length > 0;

  useEffect(() => {
    const id = requestAnimationFrame(() => composerInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [conversationId, composerInputRef]);

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
    <div className={styles.chatPage}>
      <ChatAgentToolbar onSelectionChange={onAgentSelectionChange} />
      <div className={styles.chatLayout}>
        <main className={styles.messages}>
          <StickToBottomScrollArea className={styles.messagesScroll}>
            {chatEntries.map((entry$) => (
              <ChatMessageRow
                key={messageRowKey(entry$)}
                entry$={entry$}
              />
            ))}
          </StickToBottomScrollArea>
        </main>
      </div>
      <footer className={styles.composer}>
        <input
          ref={fileInputRef}
          className={styles.hiddenFileInput}
          type="file"
          multiple
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            if (files.length === 0) return;
            setSelectedFiles((prev) => [...prev, ...files]);
            e.currentTarget.value = "";
          }}
        />
        {selectedFiles.length > 0 ? (
          <div className={styles.filePreviews}>
            {selectedFiles.map((file, idx) => (
              <button
                key={`${file.name}-${file.size}-${idx}`}
                type="button"
                className={styles.filePreview}
                onClick={() =>
                  setSelectedFiles((prev) => prev.filter((_, x) => x !== idx))
                }
                title="Remove file"
              >
                {previewUrls[idx] ? (
                  file.type === "application/pdf" ? (
                    <iframe
                      className={styles.filePreviewPdf}
                      src={previewUrls[idx]}
                      title={file.name}
                    />
                  ) : (
                    <img
                      className={styles.filePreviewImage}
                      src={previewUrls[idx]}
                      alt={file.name}
                    />
                  )
                ) : (
                  <div className={styles.filePreviewGeneric}>FILE</div>
                )}
                <div className={styles.filePreviewName}>{file.name}</div>
                <div className={styles.filePreviewRemove}>Remove</div>
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={`btn ${styles.attachButton}`}
          onClick={() => fileInputRef.current?.click()}
        >
          + File
        </button>
        <input
          className="input"
          ref={composerInputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              sendButtonRef.current?.trigger();
            }
          }}
          placeholder="Message the agent…"
        />
        <AsyncButton
          ref={sendButtonRef}
          className={`btn ${styles.sendButton}`}
          disabled={!canSend}
          onClickAsync={() => {
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
          spinnerSize={14}
        >
          Send
        </AsyncButton>
      </footer>
    </div>
  );
}
