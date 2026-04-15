import type { UserMessageEntry } from "../../../protocol/chatEntry";
import { cn } from "@/lib/utils";
import { formatExactChatTime, formatRelativeChatTime } from "../../../utils/formatRelativeChatTime";
import { ChatMessageShell } from "../ChatMessageShell";

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${Math.max(0, Math.floor(sizeBytes || 0))} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserMessageRow({ entry }: { entry: UserMessageEntry }) {
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  const relativeTime = formatRelativeChatTime(entry.createdAt);
  const exactTime = formatExactChatTime(entry.createdAt);
  return (
    <ChatMessageShell
      role="user"
      badge={
        relativeTime ? (
          <span
            className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
            title={exactTime || undefined}
          >
            {relativeTime}
          </span>
        ) : undefined
      }
    >
      {entry.text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="grid gap-2">
          {attachments.map((file) => (
            <a
              key={file.id}
              className={cn("grid gap-1 rounded-md border border-border bg-card/50 p-2 text-inherit no-underline")}
              href={file.url}
              target="_blank"
              rel="noreferrer"
            >
              {file.mimeType.startsWith("image/") ? (
                <img className="max-h-40 max-w-[240px] rounded-sm object-cover" src={file.url} alt={file.name} />
              ) : null}
              <span className="break-words font-semibold">{file.name}</span>
              <span className="break-words text-xs opacity-75">
                {file.mimeType} - {formatBytes(file.sizeBytes)}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </ChatMessageShell>
  );
}
