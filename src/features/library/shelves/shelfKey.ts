import { useSetting } from "@/lib/settings";

/**
 * Which library tab is showing: a shelf (by id) or the books that are on none of them.
 * (There is no "all books" tab: with no shelves defined the library has no tabs at all.)
 */
export type ShelfKey = "unshelved" | number;

export const UNSHELVED = "unshelved" as const;

const isShelfKey = (v: unknown): v is ShelfKey => v === UNSHELVED || (typeof v === "number" && Number.isInteger(v));

/**
 * The tab the library was last on, saved so coming back from a book's page (which unmounts the
 * library) or restarting the app lands on the same shelf. Saved in settings.json under
 * `libraryShelf` (also listed in `KNOWN` in settings.rs). May name a shelf that no longer exists;
 * `LibraryContext` falls back to the first tab then.
 */
export const useSavedShelfKey = () => useSetting<ShelfKey>("libraryShelf", UNSHELVED, isShelfKey);
