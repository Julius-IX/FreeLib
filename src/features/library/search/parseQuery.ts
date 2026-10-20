import type { BookFilter } from "@/lib/types";
import { emptyFilter } from "./emptyFilter";
import { fieldSetter } from "./fields";
import { type Token, tokenize } from "./tokenize";

/**
 * What the user typed -> the filter the backend takes.
 *
 * `tag:fantasy author:'Le Guin' dune`: every `key:value` goes to that key's definition (see
 * `fields/`), and all the loose words together become the free-text search.
 *
 * `!tag:fantasy`, `!has:cover`, `!dune`: a `!` in front leaves out the books that match the rest of
 * the token. Each one becomes its own entry in `exclude`, so they are independent of each other.
 */
export function parseQuery(input: string): BookFilter {
  const filter = emptyFilter();
  const free: string[] = [];

  for (const token of tokenize(input)) {
    if (!token.value) continue; // "tag:" while mid-typing
    if (token.negated) filter.exclude.push(...excludedBy(token));
    else if (token.key === null) free.push(token.value);
    else fieldSetter(token.key)!(filter, token.value);
  }

  if (free.length) filter.text = free.join(" ");
  return filter;
}

const NOTHING = JSON.stringify(emptyFilter());

/** The `exclude` entries one negated token stands for: none when its value is unusable. */
function excludedBy({ key, value }: Token): BookFilter[] {
  const entry = emptyFilter();
  if (key === null) entry.text = value;
  else fieldSetter(key)!(entry, value);

  if (JSON.stringify(entry) === NOTHING) return []; // "!pages:abc": nothing to leave out
  // An entry only leaves out the books matching ALL of it, but "!has:cover,isbn" means no cover
  // and no isbn: one entry per field.
  if (entry.has.length > 1) return entry.has.map((field) => ({ ...emptyFilter(), has: [field] }));
  return [entry];
}
