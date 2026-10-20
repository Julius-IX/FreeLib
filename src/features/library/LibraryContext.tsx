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
import type { Book, BookFilter, BookSort } from "@/lib/types";
import { emptyFilter } from "./search";
import { notify } from "@/notifications/notify";
import { useLibraryRevision } from "./libraryEvents";
import { useLibrarySort } from "./librarySort";
import { ShelfKey, UNSHELVED, useSavedShelfKey } from "./shelves/shelfKey";
import { useShelves } from "./shelves/useShelves";

export type ShelfTabInfo = { key: ShelfKey; label: string };

type LibraryState = {
  books: Book[];
  loading: boolean;
  filter: BookFilter;
  setFilter: (f: BookFilter) => void;
  sort: BookSort; // saved between launches, unlike the filter
  setSort: (s: BookSort) => void;
  reload: () => void; // re-run the current query (after add/edit/delete)
  /**
   * The shelf tabs, in order. EMPTY while no shelves are defined: then there are no tabs and
   * `books` is the whole library. Otherwise one tab per shelf, preceded by "Unshelved" while
   * some book is on no shelf.
   */
  shelfTabs: ShelfTabInfo[];
  /** The selected tab (`books` only has that tab's books), `null` when there are no tabs. */
  activeShelf: ShelfKey | null;
  selectShelf: (key: ShelfKey) => void;
};

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<BookFilter>(emptyFilter);
  const [sort, setSort] = useLibrarySort();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const revision = useLibraryRevision(); // bumped when a book was saved elsewhere (NewBook)

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const { shelves, loaded: shelvesLoaded } = useShelves();
  const [savedShelf, selectShelf] = useSavedShelfKey();
  const [unshelvedCount, setUnshelvedCount] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    commands.db
      .countUnshelvedBooks()
      .then((n) => {
        if (!stale) setUnshelvedCount(n);
      })
      .catch((e) => {
        console.error("couldn't count the unshelved books", e);
        if (!stale) setUnshelvedCount(0);
      });
    return () => {
      stale = true;
    };
  }, [nonce, revision]);

  // Don't query before we know whether there are tabs, or the first paint would show the whole
  // library and then jump to one shelf.
  const ready = shelvesLoaded && unshelvedCount !== null;

  const shelfTabs = useMemo<ShelfTabInfo[]>(() => {
    if (shelves.length === 0) return [];
    const tabs: ShelfTabInfo[] = shelves.map((s) => ({ key: s.shelfId, label: s.name }));
    return unshelvedCount ? [{ key: UNSHELVED, label: "Unshelved" }, ...tabs] : tabs;
  }, [shelves, unshelvedCount]);

  // The saved tab can be gone (shelf deleted, last unshelved book shelved, backup restored):
  // use the first one then.
  const activeShelf: ShelfKey | null =
    shelfTabs.length === 0 ? null : shelfTabs.some((t) => t.key === savedShelf) ? savedShelf : shelfTabs[0].key;

  const shelfIdsKey = shelves.map((s) => s.shelfId).join(",");
  // The search filter plus the tab: a search only looks inside the selected shelf.
  const queryFilter = useMemo<BookFilter>(() => {
    if (activeShelf === null) return filter;
    if (activeShelf === UNSHELVED) {
      return { ...filter, shelfIdsNone: shelfIdsKey ? shelfIdsKey.split(",").map(Number) : [] };
    }
    return { ...filter, shelfIdsAny: [activeShelf] };
  }, [filter, activeShelf, shelfIdsKey]);

  useEffect(() => {
    if (!ready) return;
    let stale = false; // ignore out-of-order responses
    setLoading(true);

    commands.db
      .filterBooks({ filter: queryFilter, sort })
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
  }, [queryFilter, sort, nonce, revision, ready]);

  const value = useMemo(
    () => ({ books, loading, filter, setFilter, sort, setSort, reload, shelfTabs, activeShelf, selectShelf }),
    [books, loading, filter, sort, setSort, reload, shelfTabs, activeShelf, selectShelf],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
