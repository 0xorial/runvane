import { createObservable, type Observable } from "./observable";

export type ObservableItem<T extends { id: string }> = Observable<T> & { id: string };

function createObservableItem<T extends { id: string }>(initial: T): ObservableItem<T> {
  const obs = createObservable(initial);
  return {
    ...obs,
    id: initial.id,
  };
}

function replaceObject<T extends object>(target: T, next: T) {
  const tgt = target as Record<string, unknown>;
  for (const key of Object.keys(tgt)) delete tgt[key];
  Object.assign(target, next);
}

export type ObservableCollection<T extends { id: string }> = {
  getItems: () => T[];
  subscribeVersion: (listener: () => void) => () => void;
  getVersion: () => number;
  replace: (items: T[]) => void;
  append: (item: T) => boolean;
  getById: (id: string) => T | undefined;
  findLastIndex: (predicate: (item: T, index: number) => boolean) => number;
  updateById: (id: string, updater: (current: T) => T) => boolean;
};

export function createObservableCollection<T extends { id: string }>(
  initial: T[] = [],
): ObservableCollection<T> {
  let items: T[] = [];
  let byId = new Map<string, T>();
  const version$ = createObservable({ value: 0 });

  function bumpVersion() {
    version$.mutate((state) => {
      state.value += 1;
    });
  }

  function replace(next: T[]) {
    items = [...next];
    byId = new Map(next.map((item) => [item.id, item]));
    bumpVersion();
  }

  function append(item: T): boolean {
    if (byId.has(item.id)) return false;
    items.push(item);
    byId.set(item.id, item);
    bumpVersion();
    return true;
  }

  function findLastIndex(predicate: (item: T, index: number) => boolean): number {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (predicate(items[i], i)) return i;
    }
    return -1;
  }

  function updateById(id: string, updater: (current: T) => T): boolean {
    const current = byId.get(id);
    if (!current) return false;
    const next = updater(current);
    byId.set(id, next);
    const idx = items.findIndex((item) => item.id === id);
    if (idx >= 0) items[idx] = next;
    bumpVersion();
    return true;
  }

  replace(initial);

  return {
    getItems: () => items,
    subscribeVersion: version$.subscribe,
    getVersion: () => version$.get().value,
    replace,
    append,
    getById: (id) => byId.get(id),
    findLastIndex,
    updateById,
  };
}

export type ObservableItemCollection<T extends { id: string }> = {
  getRows: () => ObservableItem<T>[];
  subscribeRows: (listener: () => void) => () => void;
  getRowsVersion: () => number;
  replace: (items: T[]) => void;
  append: (item: T) => boolean;
  getById: (id: string) => ObservableItem<T> | undefined;
  findLastIndex: (predicate: (item: T, index: number) => boolean) => number;
};

export function createObservableItemCollection<T extends { id: string }>(
  initial: T[] = [],
): ObservableItemCollection<T> {
  let rows: ObservableItem<T>[] = [];
  let byId = new Map<string, ObservableItem<T>>();
  const rowsVersion$ = createObservable({ value: 0 });

  function bumpRowsVersion() {
    rowsVersion$.mutate((state) => {
      state.value += 1;
    });
  }

  function replace(items: T[]) {
    const nextRows: ObservableItem<T>[] = [];
    const nextById = new Map<string, ObservableItem<T>>();

    for (const item of items) {
      const existing = byId.get(item.id);
      if (existing) {
        existing.mutate((current) => {
          replaceObject(current, item);
        });
        nextRows.push(existing);
        nextById.set(item.id, existing);
      } else {
        const row$ = createObservableItem(item);
        nextRows.push(row$);
        nextById.set(item.id, row$);
      }
    }

    rows = nextRows;
    byId = nextById;
    bumpRowsVersion();
  }

  function append(item: T): boolean {
    if (byId.has(item.id)) return false;
    const row$ = createObservableItem(item);
    rows.push(row$);
    byId.set(item.id, row$);
    bumpRowsVersion();
    return true;
  }

  function findLastIndex(predicate: (item: T, index: number) => boolean): number {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (predicate(rows[i].get(), i)) return i;
    }
    return -1;
  }

  replace(initial);

  return {
    getRows: () => rows,
    subscribeRows: rowsVersion$.subscribe,
    getRowsVersion: () => rowsVersion$.get().value,
    replace,
    append,
    getById: (id) => byId.get(id),
    findLastIndex,
  };
}
