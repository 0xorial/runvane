import type { AssistantMessageEntry } from "../../../protocol/chatEntry";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessageShell } from "../ChatMessageShell";

/* frontend2 body uses text-sm leading-relaxed; prose for markdown (slightly roomier than ultra-compact thread) */
const proseChat =
  "prose prose-sm max-w-none leading-relaxed text-foreground dark:prose-invert prose-p:my-2 prose-p:first:mt-0 prose-p:last:mb-0 prose-headings:my-2 prose-headings:scroll-mt-4 prose-headings:first:mt-0 prose-pre:my-2 prose-pre:rounded-md prose-pre:bg-zinc-950 prose-pre:p-2 prose-pre:text-[13px] prose-pre:leading-snug prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-px prose-code:text-[0.875em] prose-code:before:content-none prose-code:after:content-none prose-pre:prose-code:bg-transparent prose-pre:prose-code:p-0 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-table:my-2 prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1.5";

export function AssistantMessageRow({ entry }: { entry: AssistantMessageEntry }) {
  return (
    <ChatMessageShell role="agent">
      {entry.text ? (
        <div className={proseChat}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
            }}
          >
            {entry.text}
          </ReactMarkdown>
        </div>
      ) : null}
    </ChatMessageShell>
  );
}
