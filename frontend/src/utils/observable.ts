export type ObservableListener = () => void;

export type Observable<T extends object> = {
  get: () => T;
  mutate: (mutator: (current: T) => void) => void;
  subscribe: (listener: ObservableListener) => () => void;
};

export function createObservable<T extends object>(initial: T): Observable<T> {
  let value = initial;
  const listeners = new Set<ObservableListener>();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    get: () => value,
    mutate: (mutator) => {
      mutator(value);
      // `useSyncExternalStore` compares snapshots by reference. We mutate in place,
      // so force a new top-level reference to guarantee subscribers re-render.
      value = (Array.isArray(value)
        ? [...value]
        : { ...(value as Record<string, unknown>) }) as T;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
