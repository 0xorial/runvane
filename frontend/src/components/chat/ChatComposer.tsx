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

export type ChatComposerProps = {
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
 * Layout aligned with frontend2 ChatInput baseline + multi-row shell (refs 2–4):
 * rounded container, textarea on top, toolbar row below (attach + send).
 */
export function ChatComposer({
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
}: ChatComposerProps) {
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
    <footer className="shrink-0 border-t border-border bg-card/50 px-3 pb-2.5 pt-2 backdrop-blur-sm">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={onFileInputChange}
      />
      <div className="mx-auto w-full max-w-3xl">
        {attachmentsSlot ? (
          <div className="mb-2">{attachmentsSlot}</div>
        ) : null}

        <div
          className={cn(
            "flex flex-col gap-0 rounded-2xl border border-border bg-secondary/30 p-2 shadow-sm transition-[box-shadow,border-color]",
            "focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]",
            "dark:bg-secondary/25 dark:focus-within:border-primary/40",
          )}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={cn(
              "scrollbar-thin min-h-[32px] w-full max-h-[160px] resize-none bg-transparent px-1 py-1.5 text-sm leading-snug",
              "text-foreground placeholder:text-muted-foreground",
              "outline-none",
            )}
          />

          <div className="mt-0.5 flex items-center justify-between gap-1.5 border-t border-border/70 pt-1.5 dark:border-border/50">
            <div className="flex min-w-0 items-center gap-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                onClick={onPickFiles}
                aria-label="Attach files"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
              </Button>
              <span
                className="pointer-events-none flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground/30"
                aria-hidden
              >
                <Globe className="h-4 w-4" strokeWidth={1.75} />
              </span>
            </div>

            <AsyncButton
              ref={sendButtonRef}
              iconOnly
              disabled={!canSend}
              spinnerSize={12}
              className={cn(
                "bg-foreground text-background hover:bg-foreground/90",
                "dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90",
              )}
              onClickAsync={onSendAsync}
              ariaLabel="Send message"
            >
              <SendHorizontal className="h-4 w-4" strokeWidth={2} />
            </AsyncButton>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px] leading-tight text-muted-foreground">
          Shift+Enter for new line • Tools require configured permissions
        </p>
      </div>
    </footer>
  );
}
