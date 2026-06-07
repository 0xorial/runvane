import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { memo, useCallback, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ResizableSidePanel } from "@/components/ui/ResizableSidePanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { SidebarSelectionHighlight } from "./components/conversationSidebar/SidebarSelectionHighlight";
import { ErrorInboxButton } from "./components/ErrorInboxButton";
import { ThemeToggle } from "./components/ThemeToggle";
import { ToastHost } from "./components/ToastHost";
import { QueryClientProvider } from "@tanstack/react-query";
import { fetchConversationSession } from "./hooks/queries/conversations";
import { queryClient } from "./lib/queryClient";
import { ChatPage } from "./pages/ChatPage";
import { ComponentsPlaygroundPage } from "./pages/playground/ComponentsPlaygroundPage";
import { SettingsPage } from "./pages/SettingsPage";

function settingsLinkTo(loc: { pathname: string; search: string }) {
  if (loc.pathname.startsWith("/settings")) {
    return { pathname: loc.pathname, search: loc.search };
  }
  const agent = new URLSearchParams(loc.search).get("agent")?.trim();
  if (agent) {
    return {
      pathname: "/settings/agents",
      search: `?agent=${encodeURIComponent(agent)}`,
    };
  }
  return { pathname: "/settings/model-providers", search: "" };
}

function chatActiveIdFromPath(pathname: string): string | null {
  if (!pathname || !pathname.startsWith("/chat")) return null;
  const rest = pathname.slice("/chat".length) || "";
  const segment = rest.startsWith("/") ? rest.slice(1).split("/")[0] : "";
  return segment === "new" || !segment ? null : segment;
}

const ChatPageShell = memo(function ChatPageShell({
  sidebarVisible,
  onToggleSidebar,
  rightSidebarVisible,
  onToggleRightSidebar,
  terminalVisible,
  onToggleTerminal,
  onOpenSettings,
  settingsPressed,
}: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  rightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  settingsPressed: boolean;
}) {
  const { conversationId: raw } = useParams();
  const cid = !raw || raw === "new" ? null : String(raw);
  return (
    <ChatPage
      conversationId={cid}
      sidebarVisible={sidebarVisible}
      onToggleSidebar={onToggleSidebar}
      rightSidebarVisible={rightSidebarVisible}
      onToggleRightSidebar={onToggleRightSidebar}
      terminalVisible={terminalVisible}
      onToggleTerminal={onToggleTerminal}
      onOpenSettings={onOpenSettings}
      settingsPressed={settingsPressed}
    />
  );
});

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [chatSidebarVisible, setChatSidebarVisible] = useState(true);
  const [chatRightSidebarVisible, setChatRightSidebarVisible] = useState(true);
  const [chatTerminalVisible, setChatTerminalVisible] = useState(false);
  const activeConversationId = chatActiveIdFromPath(location.pathname);
  const showConversationSidebar = location.pathname.startsWith("/chat");
  const chatTab = location.pathname.startsWith("/chat");
  const settingsTab = location.pathname.startsWith("/settings");
  const playgroundTab = location.pathname.startsWith("/playground");
  const showTopHeader = !chatTab;
  const sidebarDefaultSize = useMemo(() => {
    if (typeof window === "undefined") return 14;
    const rawPercent = (300 / Math.max(1, window.innerWidth)) * 100;
    return Math.max(1, Math.min(95, rawPercent));
  }, []);
  const handleToggleSidebar = useCallback(() => setChatSidebarVisible((v) => !v), []);
  const handleToggleRightSidebar = useCallback(() => setChatRightSidebarVisible((v) => !v), []);
  const handleToggleTerminal = useCallback(() => setChatTerminalVisible((v) => !v), []);
  const handleNewChat = useCallback(() => navigate("/chat/new"), [navigate]);
  const handleSelectConversation = useCallback(
    (id: string) => {
      void fetchConversationSession(id);
      void navigate(`/chat/${encodeURIComponent(id)}`);
    },
    [navigate],
  );
  const handleOpenSettings = useCallback(() => navigate(settingsLinkTo(location)), [navigate, location]);
  const chatPageShell = useMemo(
    () => (
      <ChatPageShell
        sidebarVisible={chatSidebarVisible}
        onToggleSidebar={handleToggleSidebar}
        rightSidebarVisible={chatRightSidebarVisible}
        onToggleRightSidebar={handleToggleRightSidebar}
        terminalVisible={chatTerminalVisible}
        onToggleTerminal={handleToggleTerminal}
        onOpenSettings={handleOpenSettings}
        settingsPressed={settingsTab}
      />
    ),
    [
      chatSidebarVisible,
      handleToggleSidebar,
      chatRightSidebarVisible,
      handleToggleRightSidebar,
      chatTerminalVisible,
      handleToggleTerminal,
      handleOpenSettings,
      settingsTab,
    ],
  );
  const appRoutes = useMemo(
    () => (
      <Routes>
        <Route path="/chat/:conversationId" element={chatPageShell} />
        <Route path="/chat" element={<Navigate to="/chat/new" replace />} />
        <Route path="/permissions" element={<Navigate to="/settings/tools" replace />} />
        <Route path="/settings" element={<Navigate to="/settings/model-providers" replace />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="/playground/components" element={<ComponentsPlaygroundPage />} />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>
    ),
    [chatPageShell],
  );

  const conversationSidebarPanel = useMemo(
    () => (
      <div
        className={cn(
          "h-full min-h-0 min-w-0 overflow-hidden transition-opacity duration-200",
          chatSidebarVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ConversationSidebar onNewChat={handleNewChat} onSelect={handleSelectConversation} />
      </div>
    ),
    [chatSidebarVisible, handleNewChat, handleSelectConversation],
  );

  return (
    <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={300}>
      <SidebarSelectionHighlight activeConversationId={activeConversationId} />
      <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
        <ToastHost />
        {showTopHeader ? (
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50 px-3 py-2 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <span className="text-sm font-semibold tracking-tight text-foreground">Runvane</span>
              <nav className="flex flex-wrap gap-2">
                <NavLink
                  to="/chat/new"
                  className={cn(
                    buttonVariants({
                      variant: chatTab ? "default" : "outline",
                      size: "sm",
                    }),
                    "no-underline",
                  )}
                >
                  Chat
                </NavLink>
                <NavLink
                  to={settingsLinkTo(location)}
                  className={cn(
                    buttonVariants({
                      variant: settingsTab ? "default" : "outline",
                      size: "sm",
                    }),
                    "no-underline",
                  )}
                >
                  Settings
                </NavLink>
                <NavLink
                  to="/playground/components"
                  className={cn(
                    buttonVariants({
                      variant: playgroundTab ? "default" : "outline",
                      size: "sm",
                    }),
                    "no-underline",
                  )}
                >
                  Playground
                </NavLink>
              </nav>
            </div>
            <div className="relative flex items-center gap-1">
              <ThemeToggle />
              <ErrorInboxButton />
            </div>
          </header>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showConversationSidebar ? (
            <ResizableSidePanel
              open={chatSidebarVisible}
              onOpenChange={setChatSidebarVisible}
              defaultSize={sidebarDefaultSize}
              minSize={10}
              side={conversationSidebarPanel}
            >
              <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{appRoutes}</section>
            </ResizableSidePanel>
          ) : (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{appRoutes}</section>
          )}
        </div>
      </div>
    </TooltipProvider>
    </QueryClientProvider>
  );
}
