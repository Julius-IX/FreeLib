import { commands } from "@/lib/commands";
import type { Book } from "@/lib/types";
import { normIsbn } from "./inputs";
import type { Choice, Saved } from "./types";

/**
 * Turns every choice into a saved row (in order) and returns the list with real ids.
 * A draft whose name already exists (e.g. prefilled from a scan) reuses that row instead of
 * creating a duplicate, and the same row is never returned twice.
 * `normalize` is applied to the name of every draft before it's matched or created (tags: lower-case).
 */
export async function saveNew<T extends { name: string }>(
  list: Choice[],
  loadExisting: () => Promise<T[]>,
  idOf: (row: T) => number,
  create: (name: string) => Promise<number>,
  normalize: (name: string) => string = (n) => n
): Promise<Saved[]> {
  const existing = list.some((c) => c.id === null) ? await loadExisting() : [];
  const out: Saved[] = [];
  const made = new Map<string, number>(); // rows created during this call, by lower-cased name
  for (const c of list) {
    let id = c.id;
    const name = id === null ? normalize(c.name) : c.name;
    if (id === null) {
      const key = name.toLowerCase();
      const hit = existing.find((e) => e.name.toLowerCase() === key);
      id = made.get(key) ?? (hit ? idOf(hit) : await create(name));
      made.set(key, id);
    }
    if (!out.some((o) => o.id === id)) out.push({ id, name });
  }
  return out;
}

// A tag needs a tag type. New tags go under the first existing type, or a "General" one.
export async function defaultTagTypeId() {
  const types = await commands.db_crud.listTagTypes();
  return types[0]?.tagTypeId ?? (await commands.db_crud.createTagType({ name: "General" })).tagTypeId;
}

/** The book already using this ISBN, if any. (There's no ISBN filter, so list and match.) */
export async function findBookByIsbn(isbn: string): Promise<Book | null> {
  const want = normIsbn(isbn);
  if (!want) return null;
  const books = await commands.db_crud.listBooks();
  return books.find((b) => b.isbn && normIsbn(b.isbn) === want) ?? null;
}

/** Deletes the saved cover of this book, if there is one. */
export const removeCover = (bookId: number) => commands.covers.deleteCover({ bookId });
