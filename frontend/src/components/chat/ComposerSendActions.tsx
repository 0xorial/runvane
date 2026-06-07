import type { MutableRefObject } from "react";
import { Route, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { AsyncButton, type AsyncButtonHandle, type AsyncResult } from "@/components/ui/AsyncButton";
import { modifierKeyLabel } from "@/lib/submitShortcut";
import type { MessageSendMode } from "./MessageComposer";

type ComposerSendActionsProps = {
  canSend: boolean;
  agentRunning: boolean;
  onSendAsync: (mode: MessageSendMode) => Promise<AsyncResult>;
  sendButtonRef: MutableRefObject<AsyncButtonHandle | null>;
  steerButtonRef: MutableRefObject<AsyncButtonHandle | null>;
};

function ShortcutCorner({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -bottom-1 -right-1 z-10 rounded border border-border/70",
        "bg-background px-0.5 py-px font-mono text-[7px] font-semibold leading-none text-muted-foreground shadow-sm",
        className,
      )}
      aria-hidden
    >
      {label}
    </span>
  );
}

const sendBtnBase = cn(
  "!h-7 !w-7 !min-h-0 shrink-0 !rounded-full !shadow-none",
  "transition-colors duration-150",
);

const sendBtnPrimary = cn(
  sendBtnBase,
  "bg-foreground text-background hover:bg-foreground/90",
  "dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90",
);

export function ComposerSendActions({
  canSend,
  agentRunning,
  onSendAsync,
  sendButtonRef,
  steerButtonRef,
}: ComposerSendActionsProps) {
  if (agentRunning) {
    return (
      <div className="relative shrink-0" title="Command+Enter to steer">
        <AsyncButton
          ref={steerButtonRef}
          data-testid="chat-steer-button"
          iconOnly
          disabled={!canSend}
          spinnerSize={12}
          className={cn(sendBtnPrimary, "!shadow-sm")}
          onClickAsync={() => onSendAsync({ steer: true })}
          ariaLabel="Steer agent (Command+Enter)"
        >
          <Route className="h-3.5 w-3.5" strokeWidth={2.25} />
        </AsyncButton>
        <ShortcutCorner
          label={modifierKeyLabel()}
          className="border-primary/30 bg-primary text-[6px] text-primary-foreground dark:border-primary-foreground/20"
        />
      </div>
    );
  }

  return (
    <div className="relative shrink-0">
      <AsyncButton
        ref={sendButtonRef}
        data-testid="chat-send-button"
        iconOnly
        disabled={!canSend}
        spinnerSize={12}
        className={cn(sendBtnPrimary, "!shadow-sm")}
        onClickAsync={() => onSendAsync({ steer: false })}
        ariaLabel="Send message (Shift+Enter)"
      >
        <SendHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} />
      </AsyncButton>
      <ShortcutCorner label="⇧↵" />
    </div>
  );
}
