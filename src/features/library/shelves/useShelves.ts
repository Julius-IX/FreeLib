import { useCallback, useEffect, useState } from "react";
import { commands } from "@/lib/commands";
import type { Shelf } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { useLibraryRevision } from "../libraryEvents";

const same = (a: Shelf[], b: Shelf[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every shelf, in tab order. Re-read when the library revision is bumped (`bumpLibrary`), so a
 * shelf added, renamed, moved or deleted in Settings shows up in the library and on a book's
 * page. The array keeps its identity when nothing changed.
 *
 * `loaded` is false until the first read has finished (or failed, in which case the list stays
 * empty and the library simply shows no tabs).
 */
export function useShelves() {
  const revision = useLibraryRevision();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let stale = false;
    commands.db_crud
      .listShelves()
      .then((rows) => {
        if (stale) return;
        setShelves((prev) => (same(prev, rows) ? prev : rows));
        setLoaded(true);
      })
      .catch((e) => {
        if (stale) return;
        notify(`Couldn't load shelves: ${String(e)}`, { severity: "error" });
        setLoaded(true);
      });
    return () => {
      stale = true;
    };
  }, [revision, nonce]);

  return { shelves, loaded, reload };
}
