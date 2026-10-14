import { commands } from "@/lib/commands";
import type { Book } from "@/lib/types";
import { normIsbn } from "./inputs";
import type { Choice, Saved } from "./types";

/**
 * Turns every choice into a saved row (in order) and returns the list with real ids.
 * A draft whose name already exists (e.g. prefilled from a scan) reuses that row instead of
 * creating a duplicate, and the same row is never returned twice.
 */
export async function saveNew<T extends { name: string }>(
  list: Choice[],
  loadExisting: () => Promise<T[]>,
  idOf: (row: T) => number,
  create: (name: string) => Promise<number>
): Promise<Saved[]> {
  const existing = list.some((c) => c.id === null) ? await loadExisting() : [];
  const out: Saved[] = [];
  for (const c of list) {
    let id = c.id;
    if (id === null) {
      const hit = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
      id = hit ? idOf(hit) : await create(c.name);
    }
    if (!out.some((o) => o.id === id)) out.push({ id, name: c.name });
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

/** Rejects if `p` hasn't settled after `ms`, so a command that never answers can't freeze the UI. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Deletes the saved cover for this ISBN, if there is one. */
export async function removeCover(isbn: string) {
  if (await commands.covers.getCoverPath({ isbn })) await commands.covers.deleteCover({ isbn });
}
