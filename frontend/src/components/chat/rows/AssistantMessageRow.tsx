import type { AssistantMessageEntry } from "../../../protocol/chatEntry";
import { chatAssistantBubble } from "../chatMessageLayout";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* Compact thread: tight prose rhythm (panel matches rest of UI density) */
const proseChat =
  "prose prose-sm max-w-none leading-snug text-foreground dark:prose-invert prose-p:my-1 prose-p:first:mt-0 prose-p:last:mb-0 prose-headings:my-2 prose-headings:scroll-mt-4 prose-headings:first:mt-0 prose-pre:my-1 prose-pre:rounded-md prose-pre:bg-zinc-950 prose-pre:p-1.5 prose-pre:text-[13px] prose-pre:leading-snug prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-px prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none prose-pre:prose-code:bg-transparent prose-pre:prose-code:p-0 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-1 prose-th:border prose-th:border-border prose-th:px-1.5 prose-th:py-1 prose-th:text-left prose-td:border prose-td:border-border prose-td:px-1.5 prose-td:py-1";

export function AssistantMessageRow({ entry }: { entry: AssistantMessageEntry }) {
  return (
    <div className={chatAssistantBubble}>
      {entry.text ? (
        <div className={proseChat}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer noopener" />
              ),
            }}
          >
            {entry.text}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}
