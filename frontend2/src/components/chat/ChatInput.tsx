import { useState, useRef, useEffect } from "react";
import { SendHorizonal } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [value]);

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t bg-card/50 backdrop-blur-sm p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end rounded-lg border bg-secondary/30 focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/30 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none p-3 pr-12 outline-none scrollbar-thin max-h-[200px]"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="absolute right-2 bottom-2 p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Shift+Enter for new line • Tools require configured permissions
        </p>
      </div>
    </div>
  );
}
