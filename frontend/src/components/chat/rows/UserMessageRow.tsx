import type { UserMessageEntry } from "../../../protocol/chatEntry";
import { cn } from "@/lib/utils";
import { chatUserBubble } from "../chatMessageLayout";

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${Math.max(0, Math.floor(sizeBytes || 0))} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserMessageRow({ entry }: { entry: UserMessageEntry }) {
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  return (
    <div className={chatUserBubble}>
      {entry.text ? (
        <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
          {entry.text}
        </pre>
      ) : null}
      {attachments.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {attachments.map((file) => (
            <a
              key={file.id}
              className={cn(
                "grid gap-1 rounded-md border border-border bg-card/50 p-2 text-inherit no-underline",
              )}
              href={file.url}
              target="_blank"
              rel="noreferrer"
            >
              {file.mimeType.startsWith("image/") ? (
                <img
                  className="max-h-40 max-w-[240px] rounded-sm object-cover"
                  src={file.url}
                  alt={file.name}
                />
              ) : null}
              <span className="break-words font-semibold">{file.name}</span>
              <span className="break-words text-xs opacity-75">
                {file.mimeType} - {formatBytes(file.sizeBytes)}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
