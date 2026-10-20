import type { BookFilter } from "@/lib/types";
import { emptyFilter } from "./search";

/**
 * Library screen state that has to outlive the screen. Opening a book (or any other page route)
 * unmounts the library, so the search and the scroll position live here instead of in components.
 */
export const libraryViewState = {
  searchText: "",
  /** Mobile only: whether the search field is open. */
  searchOpen: false,
  filter: emptyFilter() as BookFilter,
  scrollTop: 0,
};

/** Back to a fresh library view (used when the active tab is tapped again). */
export function resetLibraryViewState() {
  libraryViewState.searchText = "";
  libraryViewState.searchOpen = false;
  libraryViewState.filter = emptyFilter();
  libraryViewState.scrollTop = 0;
}
