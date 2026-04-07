import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EditableConversationTitleProps = {
  title: string;
  disabled?: boolean;
  onCommit: (nextTitle: string) => Promise<void>;
  startEditingSignal?: number;
};

export function EditableConversationTitle({
  title,
  disabled = false,
  onCommit,
  startEditingSignal = 0,
}: EditableConversationTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  useEffect(() => {
    if (disabled) return;
    if (startEditingSignal <= 0) return;
    setEditing(true);
  }, [disabled, startEditingSignal]);

  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [editing]);

  async function commit() {
    const next = value.trim();
    if (!next || next === title.trim()) {
      setEditing(false);
      setValue(title);
      return;
    }
    setBusy(true);
    try {
      await onCommit(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setValue(title);
    }
  }

  if (editing && !disabled) {
    return (
      <Input
        ref={inputRef}
        value={value}
        maxLength={120}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className="h-7 max-w-[460px] text-sm font-medium"
        aria-label="Conversation title"
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "truncate rounded-md px-1 py-0.5 text-left text-sm font-medium text-foreground",
        "hover:bg-muted/60",
        disabled && "cursor-default hover:bg-transparent",
      )}
      disabled={disabled}
      onClick={() => setEditing(true)}
      title={disabled ? title : "Click to rename conversation"}
      aria-label={disabled ? "Conversation title" : "Edit conversation title"}
    >
      {title}
    </button>
  );
}
