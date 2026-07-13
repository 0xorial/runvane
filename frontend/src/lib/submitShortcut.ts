export function isModifierEnterKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

/** Plain Enter, no modifiers — the composer's send/enqueue key. Callers must
 *  skip IME composition (`event.isComposing`): there Enter confirms the
 *  composition, never submits. */
export function isPlainEnterKey(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/** Ctrl/Cmd+Shift+Enter — steers a running agent from the composer. */
export function isSteerEnterKey(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return e.key === "Enter" && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey;
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
