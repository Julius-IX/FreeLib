import type { BookFilter } from "@/lib/types";

/** Applies the value of one `key:value` token to the filter. Ignores a value it can't use. */
export type Setter = (f: BookFilter, v: string) => void;

/**
 * One key accepted in the search box.
 *
 * To add one: write a `FieldDef` in the file under `fields/` that fits (or a new file plus one
 * line in `fields/index.ts`). Nothing else needs to know about it. A key must be letters only.
 */
export type FieldDef = {
  /** The text before the colon, lower-case. The first is the main name, the rest aliases. */
  keys: string[];
  set: Setter;
  /** One line of documentation: what it takes. */
  help: string;
};
