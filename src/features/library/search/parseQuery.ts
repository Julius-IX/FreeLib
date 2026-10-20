import type { BookFilter } from "@/lib/types";
import { emptyFilter } from "./emptyFilter";
import { fieldSetter } from "./fields";
import { tokenize } from "./tokenize";

/**
 * What the user typed -> the filter the backend takes.
 *
 * `tag:fantasy author:'Le Guin' dune`: every `key:value` goes to that key's definition (see
 * `fields/`), and all the loose words together become the free-text search.
 */
export function parseQuery(input: string): BookFilter {
  const filter = emptyFilter();
  const free: string[] = [];

  for (const { key, value } of tokenize(input)) {
    if (!value) continue; // "tag:" while mid-typing
    if (key === null) free.push(value);
    else fieldSetter(key)!(filter, value);
  }

  if (free.length) filter.text = free.join(" ");
  return filter;
}
