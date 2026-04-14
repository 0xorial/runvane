import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ResizableSidePanel } from "@/components/ui/ResizableSidePanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ErrorInboxButton } from "./components/ErrorInboxButton";
import { ThemeToggle } from "./components/ThemeToggle";
import { ToastHost } from "./components/ToastHost";
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

function ChatPageShell({
  sidebarVisible,
  onToggleSidebar,
  onOpenSettings,
  settingsPressed,
}: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
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
      onOpenSettings={onOpenSettings}
      settingsPressed={settingsPressed}
    />
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [chatSidebarVisible, setChatSidebarVisible] = useState(true);
  const activeConversationId = chatActiveIdFromPath(location.pathname);
  const showConversationSidebar = location.pathname.startsWith("/chat");
  const chatTab = location.pathname.startsWith("/chat");
  const settingsTab = location.pathname.startsWith("/settings");
  const playgroundTab = location.pathname.startsWith("/playground");
  const showTopHeader = !chatTab;
  const appRoutes = (
    <Routes>
      <Route
        path="/chat/:conversationId"
        element={
          <ChatPageShell
            sidebarVisible={chatSidebarVisible}
            onToggleSidebar={() => setChatSidebarVisible((v) => !v)}
            onOpenSettings={() => navigate(settingsLinkTo(location))}
            settingsPressed={settingsTab}
          />
        }
      />
      <Route path="/chat" element={<Navigate to="/chat/new" replace />} />
      <Route
        path="/permissions"
        element={<Navigate to="/settings/tools" replace />}
      />
      <Route
        path="/settings"
        element={<Navigate to="/settings/model-providers" replace />}
      />
      <Route path="/settings/:section" element={<SettingsPage />} />
      <Route
        path="/playground/components"
        element={<ComponentsPlaygroundPage />}
      />
      <Route path="*" element={<Navigate to="/chat/new" replace />} />
    </Routes>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
        <ToastHost />
        {showTopHeader ? (
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50 px-3 py-2 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Runvane
              </span>
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
              defaultSize={14}
              minSize={10}
              maxSize={22}
              side={
                <div
                  className={cn(
                    "h-full min-h-0 min-w-0 overflow-hidden transition-opacity duration-200",
                    chatSidebarVisible
                      ? "opacity-100"
                      : "pointer-events-none opacity-0",
                  )}
                >
                  <ConversationSidebar
                    activeConversationId={activeConversationId}
                    onNewChat={() => navigate("/chat/new")}
                    onSelect={(id) => navigate(`/chat/${id}`)}
                  />
                </div>
              }
            >
              <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {appRoutes}
              </section>
            </ResizableSidePanel>
          ) : (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {appRoutes}
            </section>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
