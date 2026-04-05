import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ErrorInboxButton } from "./components/ErrorInboxButton";
import { ToastHost } from "./components/ToastHost";
import { ChatPage } from "./pages/ChatPage";
import { ComponentsPlaygroundPage } from "./pages/playground/ComponentsPlaygroundPage";
import { SettingsPage } from "./pages/SettingsPage";
import { cx } from "./utils/cx";
import styles from "./App.module.css";

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

  return (
    <div className={styles.app}>
      <ToastHost />
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div>Runvane</div>
          <nav className={styles.tabs}>
            <NavLink
              to="/chat/new"
              className={({ isActive }) =>
                isActive || location.pathname.startsWith("/chat")
                  ? "active"
                  : ""
              }
            >
              Chat
            </NavLink>
            <NavLink
              to={settingsLinkTo(location)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Settings
            </NavLink>
            <NavLink
              to="/playground/components"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Playground
            </NavLink>
          </nav>
        </div>
        <div className={styles.headerActions}>
          <ErrorInboxButton />
        </div>
      </header>

      <div
        className={cx(
          styles.layout,
          !showConversationSidebar && styles.settingsLayout
        )}
      >
        {showConversationSidebar ? (
          <ConversationSidebar
            activeConversationId={activeConversationId}
            onNewChat={() => navigate("/chat/new")}
            onSelect={(id) => navigate(`/chat/${id}`)}
          />
        ) : null}

        <section className={styles.main}>
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
  );
}
