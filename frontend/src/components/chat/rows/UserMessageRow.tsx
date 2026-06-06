import { useState } from "react";
import { Pencil } from "lucide-react";
import type { UserMessageEntry } from "../../../protocol/chatEntry";
import { cn } from "@/lib/utils";
import { API_BASE_URL, reprocessUserMessage } from "@/api/client";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { notifyError } from "@/utils/toast";
import { formatExactChatTime, formatRelativeChatTime } from "../../../utils/formatRelativeChatTime";
import { ChatMessageShell } from "../ChatMessageShell";
import { BranchSelector } from "../BranchSelector";
import { FoldFromHereButton } from "./FoldFromHereButton";

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${Math.max(0, Math.floor(sizeBytes || 0))} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserMessageRow({ entry }: { entry: UserMessageEntry }) {
  const { conversationId, setActiveLeaf } = useChatSessionContext();
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  const relativeTime = formatRelativeChatTime(entry.createdAt);
  const exactTime = formatExactChatTime(entry.createdAt);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(entry.text);
  const [isSaving, setIsSaving] = useState(false);
  const canEdit = Boolean(conversationId);

  async function applyEdit() {
    if (!conversationId) return;
    const text = editedText.trim();
    if (!text) return;
    setIsSaving(true);
    try {
      const result = await reprocessUserMessage(conversationId, entry.id, text);
      await setActiveLeaf(result.data.leafEntryId);
      setIsEditing(false);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to reprocess message: ${detail}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ChatMessageShell
      role="user"
      badge={
        <div className="flex items-center gap-1">
          {relativeTime ? (
            <span
              className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
              title={exactTime || undefined}
            >
              {relativeTime}
            </span>
          ) : null}
          <BranchSelector entryId={entry.id} />
          {conversationId && !isEditing ? (
            <FoldFromHereButton conversationId={conversationId} entryId={entry.id} />
          ) : null}
          {canEdit && !isEditing ? (
            <button
              type="button"
              onClick={() => {
                setEditedText(entry.text);
                setIsEditing(true);
              }}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Edit and re-run"
              aria-label="Edit and re-run"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      }
    >
      {isEditing ? (
        <div className="space-y-1.5">
          <textarea
            className="h-28 w-full resize-y rounded border border-border/70 bg-background px-2 py-1.5 text-sm leading-relaxed text-foreground focus:outline-none"
            value={editedText}
            onChange={(event) => setEditedText(event.currentTarget.value)}
            disabled={isSaving}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
              onClick={() => {
                setEditedText(entry.text);
                setIsEditing(false);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded border border-primary/50 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void applyEdit();
              }}
              disabled={isSaving || editedText.trim().length === 0}
            >
              {isSaving ? "Reprocessing..." : "Reprocess"}
            </button>
          </div>
        </div>
      ) : entry.text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
      ) : null}
      {!isEditing && attachments.length > 0 ? (
        <div className="grid gap-2">
          {attachments.map((file) => {
            // Backend returns a path relative to the API origin (e.g. `/api/uploads/<id>/content`).
            // Resolve it against the API base so the browser doesn't try to load it from the dev server.
            const href = `${API_BASE_URL}${file.url}`;
            return (
              <a
                key={file.id}
                className={cn("grid gap-1 rounded-md border border-border bg-card/50 p-2 text-inherit no-underline")}
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {file.mimeType.startsWith("image/") ? (
                  <img className="max-h-40 max-w-[240px] rounded-sm object-cover" src={href} alt={file.name} />
                ) : null}
                <span className="break-words font-semibold">{file.name}</span>
                <span className="break-words text-xs opacity-75">
                  {file.mimeType} - {formatBytes(file.sizeBytes)}
                </span>
              </a>
            );
          })}
        </div>
      ) : null}
    </ChatMessageShell>
  );
}
