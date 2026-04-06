import { Conversation } from "@/types/agent";
import { MessageSquare, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew }: ConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-0.5">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors group ${
              activeId === conv.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-medium">{conv.title}</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5.5 block mt-0.5">
              {formatDistanceToNow(conv.updatedAt, { addSuffix: true })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
