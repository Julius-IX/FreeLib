import { useSyncExternalStore } from "react";
import { normIsbn } from "./book-form/inputs";

/**
 * Tiny change feed for "a book (and maybe its cover) was just saved".
 *
 * NewBook lives outside LibraryProvider and the cards read the cover from disk once, so
 * neither would otherwise find out that something changed. Two counters:
 *   - library revision: re-run the book query (LibraryProvider listens)
 *   - per-ISBN cover revision: re-read that one cover (only that card listens, so saving one
 *     cover doesn't re-read every cover on screen)
 */
let libraryRev = 0;
const coverRevs = new Map<string, number>();
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Call after a book save has fully finished (cover included). `isbns` = every ISBN whose cover may have changed. */
export function bumpLibrary(isbns: (string | null | undefined)[]) {
  libraryRev++;
  for (const isbn of isbns) {
    if (!isbn) continue;
    const key = normIsbn(isbn);
    coverRevs.set(key, (coverRevs.get(key) ?? 0) + 1);
  }
  listeners.forEach((l) => l());
}

export const useLibraryRevision = () => useSyncExternalStore(subscribe, () => libraryRev);

export const useCoverRevision = (isbn: string | null | undefined) =>
  useSyncExternalStore(subscribe, () => (isbn ? (coverRevs.get(normIsbn(isbn)) ?? 0) : 0));
