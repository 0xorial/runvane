export function isModifierEnterKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

export function isShiftEnterKey(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export function modifierKeyLabel(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";
}
