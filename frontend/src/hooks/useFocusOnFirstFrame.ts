import { useEffect, useRef } from "react";

export function useFocusOnFirstFrame<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return ref;
}
