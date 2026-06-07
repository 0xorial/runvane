import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useRef,
} from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AsyncButtonHandle, AsyncResult } from "@/components/ui/AsyncButton";
import { isModifierEnterKey, isShiftEnterKey } from "@/lib/submitShortcut";
import { ComposerSendActions } from "./ComposerSendActions";

export type MessageSendMode = {
  steer: boolean;
};

/** Props for the chat footer where the user types and sends the next message. */
export type MessageComposerProps = {
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  value: string;
  onValueChange: (v: string) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSendAsync: (mode: MessageSendMode) => Promise<AsyncResult>;
  canSend: boolean;
  agentRunning?: boolean;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPickFiles: () => void;
  attachmentsSlot?: ReactNode;
  selectionSlot?: ReactNode;
  placeholder?: string;
};

/**
 * Bottom message input: multiline field, attach + send, hint line.
 * (Not the transcript — that lives in the scroll area above.)
 */
export function MessageComposer({
  textareaRef,
  value,
  onValueChange,
  onPaste,
  onSendAsync,
  canSend,
  agentRunning = false,
  fileInputRef,
  onFileInputChange,
  onPickFiles,
  attachmentsSlot,
  selectionSlot,
  placeholder = "Send a message…",
}: MessageComposerProps) {
  const sendButtonRef = useRef<AsyncButtonHandle>(null);
  const steerButtonRef = useRef<AsyncButtonHandle>(null);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (agentRunning) {
      if (isModifierEnterKey(e)) {
        e.preventDefault();
        steerButtonRef.current?.trigger();
      }
      return;
    }
    if (isShiftEnterKey(e)) {
      e.preventDefault();
      sendButtonRef.current?.trigger();
    }
  }

  return (
    <footer className="shrink-0 bg-card/40 px-2 pb-1.5 pt-1 backdrop-blur-sm">
      <input ref={fileInputRef} className="hidden" type="file" multiple onChange={onFileInputChange} />
      <div className="mx-auto w-full max-w-3xl">
        {attachmentsSlot ? <div className="mb-1.5">{attachmentsSlot}</div> : null}

        <div
          className={cn(
            "flex flex-col gap-0 rounded-2xl border border-border/80 bg-card/70 p-1.5 shadow-sm transition-[box-shadow,border-color]",
            "focus-within:border-primary/35 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]",
            "dark:bg-card/55 dark:focus-within:border-primary/40",
          )}
        >
          <textarea
            data-testid="chat-user-input"
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={cn(
              "scrollbar-thin min-h-[3.25rem] w-full max-h-[80px] resize-none bg-transparent px-1 py-1.5 text-sm leading-snug",
              "text-foreground placeholder:text-muted-foreground",
              "outline-none",
            )}
          />

          <div className="mt-1 flex items-end justify-between gap-2 border-t border-border/60 px-0.5 pt-1.5">
            <div className="flex min-w-0 items-center gap-1.5 pb-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
                onClick={onPickFiles}
                aria-label="Attach files"
              >
                <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span className="text-xs">Attach</span>
              </Button>
              {selectionSlot ? (
                <>
                  <span className="h-4 w-px shrink-0 bg-border/80" aria-hidden />
                  <div className="min-w-0 flex-1 overflow-hidden">{selectionSlot}</div>
                </>
              ) : null}
            </div>

            <ComposerSendActions
              canSend={canSend}
              agentRunning={agentRunning}
              onSendAsync={onSendAsync}
              sendButtonRef={sendButtonRef}
              steerButtonRef={steerButtonRef}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
