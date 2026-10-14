import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { commands } from "@/lib/commands";
import type { Book, BookFilter } from "@/lib/types";
import { emptyFilter } from "./searchQuery";
import { notify } from "@/notifications/notify";

type LibraryState = {
  books: Book[];
  loading: boolean;
  filter: BookFilter;
  setFilter: (f: BookFilter) => void;
  reload: () => void; // re-run the current query (after add/edit/delete)
};

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<BookFilter>(emptyFilter);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let stale = false; // ignore out-of-order responses
    setLoading(true);

    commands.db
      .filterBooks({ filter })
      .then((b) => {
        if (!stale) setBooks(b);
      })
      .catch((e) => notify(String(e)))
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [filter, nonce]);

  const value = useMemo(
    () => ({ books, loading, filter, setFilter, reload }),
    [books, loading, filter, reload],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
