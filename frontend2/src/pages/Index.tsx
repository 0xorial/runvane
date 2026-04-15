import { useState } from "react";
import { ConversationList } from "@/components/sidebar/ConversationList";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ActivityPanel } from "@/components/panels/ActivityPanel";
import { ToolRegistry } from "@/components/tools/ToolRegistry";
import { mockConversations, mockTools } from "@/data/mockData";
import { Conversation, ToolDefinition, ToolPermission, ChatMessage as ChatMessageType } from "@/types/agent";
import { Bot, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Wrench, Activity } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const Index = () => {
  const [conversations, setConversations] = useState<Conversation[]>(mockConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(mockConversations[0]?.id ?? null);
  const [tools, setTools] = useState<ToolDefinition[]>(mockTools);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"activity" | "tools">("activity");

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const handleNewChat = () => {
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: "New conversation",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
  };

  const handleSend = (content: string) => {
    if (!activeConvId) return;
    const msg: ChatMessageType = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c)),
    );
  };

  const handlePermissionChange = (toolId: string, permission: ToolPermission) => {
    setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, permission } : t)));
  };

  const handleToolDecision = (toolCallId: string, approved: boolean) => {
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((msg) => ({
          ...msg,
          toolCalls: msg.toolCalls?.map((tc) =>
            tc.id === toolCallId
              ? {
                  ...tc,
                  status: approved ? ("completed" as const) : ("failed" as const),
                  result: approved ? "Approved by user — executed successfully." : "Denied by user.",
                  completedAt: Date.now(),
                }
              : tc,
          ),
        })),
      })),
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div
        className={`border-r bg-sidebar flex flex-col transition-all duration-200 ${
          leftOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-3 border-b flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold text-foreground tracking-tight">AgentOS</span>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={activeConvId}
          onSelect={setActiveConvId}
          onNew={handleNewChat}
        />
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-11 border-b flex items-center px-3 gap-2 bg-card/50 backdrop-blur-sm shrink-0">
          <button
            onClick={() => setLeftOpen(!leftOpen)}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
          >
            {leftOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          <span className="text-sm font-medium text-foreground truncate">{activeConv?.title ?? "No conversation"}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setRightOpen(!rightOpen)}
              className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
            >
              {rightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4">
          {activeConv && activeConv.messages.length > 0 ? (
            activeConv.messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onToolApprove={(id) => handleToolDecision(id, true)}
                onToolDeny={(id) => handleToolDecision(id, false)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Bot className="w-10 h-10 mb-3 text-primary/30" />
              <p className="text-sm">Start a conversation</p>
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput onSend={handleSend} />
      </div>

      {/* Right Panel */}
      <div
        className={`border-l bg-sidebar flex flex-col transition-all duration-200 ${
          rightOpen ? "w-72" : "w-0"
        } overflow-hidden`}
      >
        {/* Tabs */}
        <div className="flex border-b shrink-0">
          <button
            onClick={() => setRightTab("activity")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              rightTab === "activity"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Activity
          </button>
          <button
            onClick={() => setRightTab("tools")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              rightTab === "tools"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            Tools
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {rightTab === "activity" ? (
            <ActivityPanel messages={activeConv?.messages ?? []} />
          ) : (
            <ToolRegistry tools={tools} onPermissionChange={handlePermissionChange} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
