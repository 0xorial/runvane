import { writable, derived } from "svelte/store";

export const pathname = writable(
  typeof window !== "undefined" ? window.location.pathname + window.location.search : "/chat/new",
);

export function navigate(to: string): void {
  history.pushState({}, "", to);
  pathname.set(to);
}

export function replacePath(to: string): void {
  history.replaceState({}, "", to);
  pathname.set(to);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    pathname.set(window.location.pathname + window.location.search);
  });
}

export const pathOnly = derived(pathname, ($path) => $path.split("?")[0] ?? "/");

export const chatSearch = derived(pathname, ($path) => {
  const q = $path.indexOf("?");
  return q >= 0 ? $path.slice(q) : "";
});

export const chatConversationId = derived(pathname, ($path) => {
  const pathOnly = $path.split("?")[0] ?? "";
  const match = pathOnly.match(/^\/chat\/([^/]+)/);
  if (!match?.[1] || match[1] === "new") return null;
  return match[1];
});

export const settingsSection = derived(pathOnly, ($path) => {
  const match = $path.match(/^\/settings\/([^/]+)/);
  return match?.[1];
});

export const isChatRoute = derived(pathOnly, ($path) => $path.startsWith("/chat"));
export const isSettingsRoute = derived(pathOnly, ($path) => $path.startsWith("/settings"));
export const isConversationsRoute = derived(pathOnly, ($path) => $path.startsWith("/conversations"));

export function agentIdFromSearch(search: string): string {
  return new URLSearchParams(search).get("agent")?.trim() ?? "";
}

export function toolEnvironmentIdFromSearch(search: string): string {
  return new URLSearchParams(search).get("env")?.trim() ?? "";
}

export function settingsLinkFromSearch(search: string): string {
  const agent = new URLSearchParams(search).get("agent")?.trim();
  if (agent) return `/settings/agents?agent=${encodeURIComponent(agent)}`;
  return "/settings/model-providers";
}
