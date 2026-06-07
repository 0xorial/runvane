const STORE_EVENT = "runvane:toast-store";

export type ToastType = "error" | "success";

export type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
  createdAt: number;
  durationMs: number;
  hidden: boolean;
};

type ToastStoreDetail = { items: ToastItem[] };

const state = { nextId: 1, items: [] as ToastItem[] };

function emitStore(): void {
  window.dispatchEvent(
    new CustomEvent(STORE_EVENT, { detail: { items: [...state.items] } satisfies ToastStoreDetail }),
  );
}

export function getToastStoreSnapshot(): ToastItem[] {
  return [...state.items];
}

export function subscribeToastStore(onChange: (items: ToastItem[]) => void): () => void {
  function onStore(event: Event): void {
    const ce = event as CustomEvent<ToastStoreDetail>;
    onChange(ce.detail?.items ?? []);
  }
  window.addEventListener(STORE_EVENT, onStore);
  onChange(getToastStoreSnapshot());
  return () => window.removeEventListener(STORE_EVENT, onStore);
}

export function dismissToast(id: number): void {
  state.items = state.items.filter((x) => x.id !== id);
  emitStore();
}

export function notifyToast({
  message,
  type = "error",
  durationMs = 8000,
}: {
  message: string;
  type?: ToastType;
  durationMs?: number;
}): void {
  if (!message) return;
  const id = state.nextId++;
  const ms = Number(durationMs) > 0 ? Number(durationMs) : 8000;
  state.items = [
    ...state.items,
    { id, message: String(message), type, createdAt: Date.now(), durationMs: ms, hidden: false },
  ];
  emitStore();
}

export function notifyError(message: string, durationMs = 8000): void {
  notifyToast({ message, type: "error", durationMs });
}

export function notifySuccess(message: string, durationMs = 4000): void {
  notifyToast({ message, type: "success", durationMs });
}
