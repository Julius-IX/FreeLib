import type { BookInput, Category } from "@/lib/types";

/**
 * An author / tag / series the user picked. `id: null` means it doesn't exist yet:
 * it's only written to the database when the book itself is created.
 */
export type Choice = { id: number | null; name: string };
export type Saved = { id: number; name: string };

/**
 * A prefilled author / tag / series. `{ name }` is matched against what's already in the
 * library when the book is created (reused if found, created if not). Add `id` if there already
 * is an existing row.
 */
export type DraftRef = { id?: number | null; name: string };

export type BookDraft = {
  title?: string;
  isbn?: string | null;
  publishDate?: string | null; // YYYY-MM-DD
  blurb?: string | null;
  pageCount?: number | null;
  authors?: DraftRef[];
  tags?: DraftRef[];
  /** Existing categories only: they cannot be created from the book form. */
  categories?: Category[];
  series?: DraftRef | null;
  seriesPosition?: number | null;
  cover?: string | null; // link or local file path
};

/** What the form edits directly. Authors, tags, series and the date have their own state. */
export type BookFields = Omit<BookInput, "authorIds" | "tagIds" | "categoryIds" | "seriesId" | "publishDate">;
