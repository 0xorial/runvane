/** Move a DOM node to document.body so popovers escape overflow/backdrop-filter clipping. */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
