const STORE_EVENT = "runvane:toast-store";
const TOAST_EVENT = "runvane:toast";

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

const state: {
  nextId: number;
  items: ToastItem[];
} = {
  nextId: 1,
  items: [],
};

function emitStore(): void {
  window.dispatchEvent(
    new CustomEvent(STORE_EVENT, {
      detail: { items: [...state.items] } satisfies ToastStoreDetail,
    }),
  );
}

export function getToastStoreSnapshot(): ToastItem[] {
  return [...state.items];
}

export function subscribeToastStore(
  onChange: (items: ToastItem[]) => void,
): () => void {
  function onStore(event: Event) {
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

export function ignoreToast(id: number): void {
  state.items = state.items.map((x) =>
    x.id === id ? { ...x, hidden: true } : x,
  );
  emitStore();
}

export function dismissAllToasts(): void {
  state.items = [];
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
  const now = Date.now();
  const ms = Number(durationMs) > 0 ? Number(durationMs) : 8000;
  const item: ToastItem = {
    id,
    message: String(message),
    type,
    createdAt: now,
    durationMs: ms,
    hidden: false,
  };
  state.items = [...state.items, item];
  emitStore();
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: { id, message: String(message), type, durationMs: ms },
    }),
  );
}

export function notifyError(message: string, durationMs = 8000): void {
  notifyToast({ message, type: "error", durationMs });
}
