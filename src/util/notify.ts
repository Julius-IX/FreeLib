export type NotifyOptions = {
  /** Omit for the plain dark toast. Set for a colored one. */
  severity?: "success" | "info" | "warning" | "error";
  /** ms before auto-hide. */
  duration?: number;
  /** Optional button, e.g. { label: "Undo", onClick: restore } */
  action?: { label: string; onClick: () => void };
};

export type Item = NotifyOptions & { key: number; message: string };

let nextKey = 0;
let listener: ((item: Item) => void) | null = null;
const pending: Item[] = []; // calls made before <SnackbarHost /> mounts

export function notify(message: string, options: NotifyOptions = {}) {
  const item: Item = { ...options, message, key: nextKey++ };
  if (listener) listener(item);
  else pending.push(item);
}

// Used by SnackbarHost only. Registers the listener and flushes anything queued early.
export function subscribe(fn: (item: Item) => void) {
  listener = fn;
  pending.splice(0).forEach(fn);
  return () => {
    if (listener === fn) listener = null;
  };
}
