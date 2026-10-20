import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { useLibraryRevision } from "../libraryEvents";
import type { BookViewState } from "./types";

/**
 * Loads a book with its authors, tags, categories, series and readings. Re-runs when a book was saved
 * elsewhere (the edit screen) or when `reload()` is called (after start / end read).
 * If a refresh fails after a successful load (e.g. the book was just deleted) the data
 * on screen is kept. A first load that fails ends in `missing` and tells the user why.
 */
export function useBookDetails(param: string | undefined) {
  const id = param !== undefined && /^\d+$/.test(param) ? Number(param) : NaN;
  const revision = useLibraryRevision();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [state, setState] = useState<BookViewState>({ status: "loading" });
  const loadedFor = useRef<number | null>(null);
  const notifiedFor = useRef<string | null>(null);

  useEffect(() => {
    let stale = false;

    const fail = (message: string, toast: string) => {
      if (stale || loadedFor.current === id) return;
      setState({ status: "missing", message });
      if (notifiedFor.current !== message) {
        notifiedFor.current = message; // StrictMode runs effects twice. One toast is enough
        notify(toast, { severity: "error", duration: 8000 });
      }
    };

    if (!Number.isInteger(id)) {
      fail("This book link isn't valid.", "That book link isn't valid.");
      return;
    }

    (async () => {
      const [book, authors, tags, categories, readings] = await Promise.all([
        commands.db_crud.getBook({ bookId: id }),
        commands.db_crud.getBookAuthors({ bookId: id }),
        commands.db_crud.getBookTags({ bookId: id }),
        commands.db.getAllCategories({ bookId: id }),
        commands.db_crud.listReadings({ bookId: id }),
      ]);
      const series = book.seriesId !== null ? await commands.db_crud.getSeries({ seriesId: book.seriesId }) : null;
      if (stale) return;
      loadedFor.current = id;
      setState({ status: "ready", details: { book, authors, tags, categories, series }, readings });
    })().catch((e) => {
      console.error(`useBookDetails: couldn't load book ${id}`, e);
      fail("This book doesn't exist anymore, or couldn't be loaded.", `Couldn't open this book: ${String(e)}`);
    });

    return () => {
      stale = true;
    };
  }, [id, revision, nonce]);

  return { state, reload };
}
