import { useEffect, useRef, useState } from "react";

/** The width of an element in px, kept up to date. Charts are drawn at their real size, so their
 * text stays readable on a phone instead of shrinking with a `viewBox`. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
