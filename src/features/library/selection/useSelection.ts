import { useCallback, useEffect, useRef, useState } from "react";
import type { Book } from "@/lib/types";

const EMPTY: ReadonlySet<number> = new Set();

/**
 * Multi-select state for the library grid. The selection only ever holds books that are on screen.
 * Whatever drops out of `books` (a new search, another shelf tab, a delete) is dropped here too, so
 * a bulk action can never touch a book that is not visible.
 */
export function useSelection(books: Book[]) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(EMPTY);
  // the last book clicked, where a shift-click range starts
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(books.map((b) => b.bookId));
      const next = [...prev].filter((id) => visible.has(id));
      return next.length === prev.size ? prev : new Set(next);
    });
  }, [books]);

  /** Turns the mode on with nothing selected. */
  const enter = useCallback(() => setActive(true), []);

  /** Turns the mode on and selects the book. Selecting an already selected one is a no-op. */
  const start = useCallback((id: number) => {
    setActive(true);
    setSelected((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    anchor.current = id;
  }, []);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);

  /** Selects everything between the last clicked book and `id`, in the order of `ordered`. */
  const selectRange = useCallback(
    (ordered: Book[], id: number) => {
      const to = ordered.findIndex((b) => b.bookId === id);
      const from = anchor.current === null ? -1 : ordered.findIndex((b) => b.bookId === anchor.current);
      if (to < 0) return;
      if (from < 0) return toggle(id);
      const [low, high] = from < to ? [from, to] : [to, from];
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = low; i <= high; i++) next.add(ordered[i].bookId);
        return next;
      });
      anchor.current = id;
    },
    [toggle],
  );

  const selectAll = useCallback((ordered: Book[]) => {
    setSelected(new Set(ordered.map((b) => b.bookId)));
  }, []);

  const invert = useCallback((ordered: Book[]) => {
    setSelected((prev) => new Set(ordered.filter((b) => !prev.has(b.bookId)).map((b) => b.bookId)));
  }, []);

  const deselectAll = useCallback(() => setSelected(EMPTY), []);

  /** Leaves the mode and forgets the selection. */
  const close = useCallback(() => {
    setActive(false);
    setSelected(EMPTY);
    anchor.current = null;
  }, []);

  return { active, selected, enter, start, toggle, selectRange, selectAll, invert, deselectAll, close };
}

export type Selection = ReturnType<typeof useSelection>;
