import { useEffect, useRef } from "react";

/** A ref that is true while the component is mounted, for async work that finishes after it left. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** Runs `fn` on mount, once even under StrictMode's double effect run in dev. */
export function useOnce(fn: () => void) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fn();
  }, []);
}

/** A ref that always holds the latest `value`, so effects can call it without re-running. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
