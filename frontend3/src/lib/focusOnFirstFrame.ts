export function focusOnFirstFrame(node: HTMLElement): { destroy(): void } {
  const id = requestAnimationFrame(() => node.focus());
  return {
    destroy() {
      cancelAnimationFrame(id);
    },
  };
}
