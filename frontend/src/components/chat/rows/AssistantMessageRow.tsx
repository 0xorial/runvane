import { cx } from "../../../utils/cx";
import type { AssistantMessageEntry } from "../../../protocol/chatEntry";
import rowStyles from "../ChatMessageRow.module.css";
import styles from "./AssistantMessageRow.module.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMessageRow({ entry }: { entry: AssistantMessageEntry }) {
  return (
    <div className={cx(rowStyles.msg, rowStyles.assistant, styles.assistantMessageRow)}>
      {entry.text ? (
        <div className={styles.markdown}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noreferrer noopener"
                />
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
