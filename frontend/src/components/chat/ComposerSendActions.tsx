import type { MutableRefObject, ReactNode } from "react";
import { ListPlus, Route, SendHorizontal } from "lucide-react";
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
  enqueueButtonRef: MutableRefObject<AsyncButtonHandle | null>;
};

/**
 * Button content: icon + label + keycap, laid out with real gaps. AsyncButton
 * drops `children` into a plain inline span, so we own the flex here.
 */
function PillContent({
  icon,
  label,
  keys,
  keycapClassName,
}: {
  icon: ReactNode;
  label: string;
  keys: string;
  keycapClassName: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <kbd
        className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none tracking-tight",
          keycapClassName,
        )}
      >
        {keys}
      </kbd>
    </span>
  );
}

const pillBase = "!h-8 !min-h-0 shrink-0 !rounded-full !px-3 !text-xs !font-semibold";

const pillPrimary = cn(
  pillBase,
  "!shadow-sm bg-foreground text-background hover:bg-foreground/90",
  "dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90",
);

const pillSteer = cn(
  pillBase,
  "!bg-transparent !shadow-none border border-destructive/40 text-destructive hover:!bg-destructive/10",
);

// Solid keycap on the filled pill; tinted keycap on the outline pill.
const keycapPrimary = "bg-background/90 text-foreground dark:bg-primary-foreground/90 dark:text-primary";
const keycapSteer = "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30";

export function ComposerSendActions({
  canSend,
  agentRunning,
  onSendAsync,
  sendButtonRef,
  steerButtonRef,
  enqueueButtonRef,
}: ComposerSendActionsProps) {
  const mod = modifierKeyLabel();

  if (agentRunning) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <AsyncButton
          ref={steerButtonRef}
          data-testid="chat-steer-button"
          disabled={!canSend}
          spinnerSize={12}
          className={pillSteer}
          onClickAsync={() => onSendAsync({ steer: true })}
          ariaLabel={`Steer agent (${mod}+Enter)`}
        >
          <PillContent
            icon={<Route className="h-3.5 w-3.5" strokeWidth={2.25} />}
            label="Steer"
            keys={`${mod}⏎`}
            keycapClassName={keycapSteer}
          />
        </AsyncButton>
        <AsyncButton
          ref={enqueueButtonRef}
          data-testid="chat-enqueue-button"
          disabled={!canSend}
          spinnerSize={12}
          className={pillPrimary}
          onClickAsync={() => onSendAsync({ enqueue: true })}
          ariaLabel="Enqueue message (Shift+Enter)"
        >
          <PillContent
            icon={<ListPlus className="h-3.5 w-3.5" strokeWidth={2.25} />}
            label="Enqueue"
            keys="⇧⏎"
            keycapClassName={keycapPrimary}
          />
        </AsyncButton>
      </div>
    );
  }

  return (
    <AsyncButton
      ref={sendButtonRef}
      data-testid="chat-send-button"
      disabled={!canSend}
      spinnerSize={12}
      className={pillPrimary}
      onClickAsync={() => onSendAsync({})}
      ariaLabel="Send message (Shift+Enter)"
    >
      <PillContent
        icon={<SendHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} />}
        label="Send"
        keys="⇧⏎"
        keycapClassName={keycapPrimary}
      />
    </AsyncButton>
  );
}
