import { cx } from "../../../utils/cx";
import type { UserMessageEntry } from "../../../protocol/chatEntry";
import styles from "../ChatMessageRow.module.css";

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${Math.max(0, Math.floor(sizeBytes || 0))} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserMessageRow({ entry }: { entry: UserMessageEntry }) {
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  return (
    <div className={cx(styles.msg, styles.user)}>
      {entry.text ? <pre className={styles.msgAnswer}>{entry.text}</pre> : null}
      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          {attachments.map((file) => (
            <a
              key={file.id}
              className={styles.attachment}
              href={file.url}
              target="_blank"
              rel="noreferrer"
            >
              {file.mimeType.startsWith("image/") ? (
                <img className={styles.attachmentImage} src={file.url} alt={file.name} />
              ) : null}
              <span className={styles.attachmentName}>{file.name}</span>
              <span className={styles.attachmentMeta}>
                {file.mimeType} - {formatBytes(file.sizeBytes)}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
