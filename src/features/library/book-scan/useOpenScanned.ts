import { useNavigate } from "react-router-dom";
import { LibraryPath } from "../routes";
import type { NewBookState } from "../screens/NewBook";
import { lookupBook } from "./lookup";

/**
 * Shared by the desktop and mobile scanners: looks the scanned code up and, on success, replaces
 * the scan screen with Add Book prefilled from the result (replace, so Back returns to the
 * library rather than to the scanner). Resolves with an error message on failure, else null.
 */
export function useOpenScanned() {
  const navigate = useNavigate();

  return async (code: string): Promise<string | null> => {
    try {
      const initial = await lookupBook(code);
      // absolute: a relative "add-book" would resolve under `scan`
      navigate(`/${LibraryPath.AddBook}`, { replace: true, state: { initial } satisfies NewBookState });
      return null;
    } catch (e) {
      return e instanceof Error && e.message ? e.message : "Couldn't look that code up";
    }
  };
}
