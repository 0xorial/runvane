export function isModifierEnterKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

export function modifierKeyLabel(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";
}
