import { useNavigate } from "react-router-dom";
import { notify } from "@/notifications/notify";
import { LibraryPath } from "../routes";
import type { NewBookState } from "../screens/NewBook";
import { lookupBook } from "./lookup";

/**
 * Shared by the desktop and mobile scanners: looks the scanned code up and replaces the scan
 * screen with Add Book prefilled from the result (replace, so Back returns to the library rather
 * than to the scanner).
 *
 * If no plugin finds the book, the user is told (a toast) and still lands in Add Book with the
 * ISBN filled in. Only a code that isn't an ISBN stays on the scan screen: resolves with an error
 * message for that, else null.
 */
export function useOpenScanned() {
  const navigate = useNavigate();

  return async (code: string): Promise<string | null> => {
    try {
      const { draft: initial, problem } = await lookupBook(code);
      if (problem) notify(problem, { severity: "error", duration: 5000 });
      // absolute: a relative "add-book" would resolve under `scan`
      navigate(`/${LibraryPath.AddBook}`, { replace: true, state: { initial } satisfies NewBookState });
      return null;
    } catch (e) {
      return e instanceof Error && e.message ? e.message : "Couldn't look that code up";
    }
  };
}
