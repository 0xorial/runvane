import { useSyncExternalStore } from "react";
import type { Observable } from "../utils/observable";

export function useObservableValue<T extends object>(observable: Observable<T>): T {
  useSyncExternalStore(observable.subscribe, observable.get, observable.get);
  return observable.get();
}
