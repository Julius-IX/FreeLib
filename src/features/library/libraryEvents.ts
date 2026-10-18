import { useSyncExternalStore } from "react";

/**
 * Tiny change feed for "a book (and maybe its cover) was just saved".
 *
 * NewBook lives outside LibraryProvider and the cards read the cover from disk once, so
 * neither would otherwise find out that something changed. Two counters:
 *   - library revision: re-run the book query (LibraryProvider listens)
 *   - per-book cover revision: re-read that one cover (only that card listens, so saving one
 *     cover doesn't re-read every cover on screen)
 */
let libraryRev = 0;
const coverRevs = new Map<number, number>();
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Call after a book save has fully finished (cover included). `bookIds` = every book whose cover may have changed. */
export function bumpLibrary(bookIds: (number | null | undefined)[]) {
  libraryRev++;
  for (const id of bookIds) {
    if (id == null) continue;
    coverRevs.set(id, (coverRevs.get(id) ?? 0) + 1);
  }
  listeners.forEach((l) => l());
}

export const useLibraryRevision = () => useSyncExternalStore(subscribe, () => libraryRev);

export const useCoverRevision = (bookId: number | null | undefined) =>
  useSyncExternalStore(subscribe, () => (bookId != null ? (coverRevs.get(bookId) ?? 0) : 0));
