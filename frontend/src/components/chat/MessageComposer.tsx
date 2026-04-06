import {
  useEffect,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Globe, Plus, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AsyncButton,
  type AsyncButtonHandle,
  type AsyncResult,
} from "@/components/ui/AsyncButton";

/** Props for the chat footer where the user types and sends the next message. */
export type MessageComposerProps = {
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  sendButtonRef: MutableRefObject<AsyncButtonHandle | null>;
  value: string;
  onValueChange: (v: string) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSendAsync: (e: MouseEvent<HTMLButtonElement>) => Promise<AsyncResult>;
  canSend: boolean;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPickFiles: () => void;
  attachmentsSlot?: ReactNode;
  placeholder?: string;
};

/**
 * Bottom message input: multiline field, attach + send, hint line.
 * (Not the transcript — that lives in the scroll area above.)
 */
export function MessageComposer({
  textareaRef,
  sendButtonRef,
  value,
  onValueChange,
  onPaste,
  onSendAsync,
  canSend,
  fileInputRef,
  onFileInputChange,
  onPickFiles,
  attachmentsSlot,
  placeholder = "Send a message…",
}: MessageComposerProps) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, textareaRef]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendButtonRef.current?.trigger();
    }
  }

  return (
    <footer className="shrink-0 bg-card/40 px-2 pb-1.5 pt-1 backdrop-blur-sm">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={onFileInputChange}
      />
      <div className="mx-auto w-full max-w-3xl">
        {attachmentsSlot ? (
          <div className="mb-1.5">{attachmentsSlot}</div>
        ) : null}

        <div
          className={cn(
            "flex flex-col gap-0 rounded-xl border border-border bg-secondary/30 p-1.5 shadow-sm transition-[box-shadow,border-color]",
            "focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]",
            "dark:bg-secondary/25 dark:focus-within:border-primary/40",
          )}
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={cn(
              "scrollbar-thin min-h-[3.25rem] w-full max-h-[160px] resize-none bg-transparent px-1 py-1.5 text-sm leading-snug",
              "text-foreground placeholder:text-muted-foreground",
              "outline-none",
            )}
          />

          <div className="flex items-center justify-between gap-1 px-0.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                onClick={onPickFiles}
                aria-label="Attach files"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
              <span
                className="pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground/30"
                aria-hidden
              >
                <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
            </div>

            <AsyncButton
              ref={sendButtonRef}
              iconOnly
              disabled={!canSend}
              spinnerSize={12}
              className={cn(
                "!h-7 !w-7 bg-foreground text-background hover:bg-foreground/90",
                "dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90",
              )}
              onClickAsync={onSendAsync}
              ariaLabel="Send message"
            >
              <SendHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
            </AsyncButton>
          </div>
        </div>
      </div>
    </footer>
  );
}
