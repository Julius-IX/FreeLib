import { useSyncExternalStore } from "react";

let mounted = false;
const listeners = new Set<() => void>();

export const setModalMounted = (v: boolean) => {
  if (mounted === v) return;
  mounted = v;
  listeners.forEach((l) => l());
};

export const useModalMounted = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => mounted
  );
