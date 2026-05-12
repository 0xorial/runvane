import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyError } from "@/utils/toast";

type CopyButtonProps = {
  value: string;
  className?: string;
  title?: string;
};

export function CopyButton({ value, className, title = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function onCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Copy failed: ${detail}`);
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => {
        void onCopy();
      }}
      title={copied ? "Copied" : title}
      aria-label={copied ? "Copied" : title}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
