import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { useLibraryRevision } from "../libraryEvents";

/**
 * A book's rating (0-10, 0 = not rated). `rating` is `null` until it has been read, and stays
 * `null` if reading it fails: better no rating row than an empty one that could be tapped,
 * and would then overwrite the real rating.
 *
 * `save` shows the new value at once and writes it in the background. Writes go out one at a
 * time, in the order they were made, so quick taps can't land out of order. If one fails, the
 * screen goes back to the last value the database confirmed (unless a newer tap is already on
 * its way: that one decides).
 *
 * `enabled = false` (the rating is hidden in settings) skips reading it.
 */
export function useBookRating(bookId: number, enabled = true) {
  const revision = useLibraryRevision();
  const [rating, setRating] = useState<number | null>(null);
  const confirmed = useRef(0); // last value the database has
  const pending = useRef(0); // saves started and not finished yet
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    commands.db_crud
      .getBookRating({ bookId })
      .then((value) => {
        if (stale || pending.current > 0) return; // a tap in flight knows better
        confirmed.current = value;
        setRating(value);
      })
      .catch((e) => console.error(`useBookRating: couldn't read the rating of book ${bookId}`, e));
    return () => {
      stale = true;
    };
  }, [bookId, enabled, revision]);

  const save = useCallback(
    (next: number) => {
      setRating(next);
      pending.current++;
      queue.current = queue.current.then(async () => {
        try {
          await commands.db_crud.updateBookRating({ bookId, rating: next });
          confirmed.current = next;
        } catch (e) {
          if (pending.current === 1) setRating(confirmed.current);
          notify(`Couldn't save the rating: ${String(e)}`, { severity: "error" });
        } finally {
          pending.current--;
        }
      });
    },
    [bookId],
  );

  return { rating, save };
}
