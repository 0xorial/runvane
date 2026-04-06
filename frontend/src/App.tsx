import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
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

/**
 * USER_INVARIANT[RV-005]: Single shell for `/chat/new` and `/chat/:id` so navigating
 * new → id does **not** remount ChatPage (SSE + state survive). Param `new` → null.
 */
function ChatPageShell() {
  const { conversationId: raw } = useParams();
  const cid = !raw || raw === "new" ? null : String(raw);
  return <ChatPage conversationId={cid} />;
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeConversationId = chatActiveIdFromPath(location.pathname);
  const showConversationSidebar = location.pathname.startsWith("/chat");
  const chatTab = location.pathname.startsWith("/chat");
  const settingsTab = location.pathname.startsWith("/settings");
  const playgroundTab = location.pathname.startsWith("/playground");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
        <ToastHost />
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-3 md:gap-4">
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

        <div
          className={cn(
            "grid min-h-0 flex-1 overflow-hidden",
            showConversationSidebar
              ? "grid-cols-[260px_minmax(0,1fr)]"
              : "grid-cols-1",
          )}
        >
          {showConversationSidebar ? (
            <ConversationSidebar
              activeConversationId={activeConversationId}
              onNewChat={() => navigate("/chat/new")}
              onSelect={(id) => navigate(`/chat/${id}`)}
            />
          ) : null}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Routes>
              <Route path="/chat/:conversationId" element={<ChatPageShell />} />
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
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}
