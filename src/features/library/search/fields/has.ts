import type { BookField } from "@/lib/types";
import type { FieldDef, ValueHint } from "./types";

// Names accepted after `has:`, and the field each name stands for. The first name of each
// group is the main one, the rest are what people tend to type.
const NAMES: Record<BookField, string[]> = {
  isbn: ["isbn"],
  cover: ["cover", "covers", "image", "picture"],
  rating: ["rating", "rated"],
  blurb: ["blurb", "description"],
  notes: ["notes", "note"],
  published: ["published", "pub", "date", "year"],
  pages: ["pages", "pagecount"],
  series: ["series"],
  author: ["author", "authors"],
  tag: ["tag", "tags"],
  category: ["category", "categories", "cat"],
  shelf: ["shelf", "shelves"],
};

// What a book needs to pass, for the suggestions list.
const HELP: Record<BookField, string> = {
  isbn: "has an ISBN",
  cover: "has a cover image",
  rating: "is rated",
  blurb: "has a blurb",
  notes: "has notes",
  published: "has a publish date",
  pages: "has a page count",
  series: "belongs to a series",
  author: "has an author",
  tag: "has a tag",
  category: "has a category",
  shelf: "is on a shelf",
};

const HINTS: ValueHint[] = (Object.entries(NAMES) as [BookField, string[]][]).map(
  ([field, [value, ...aliases]]) => ({ value, aliases, help: HELP[field] }),
);

const BY_NAME = new Map<string, BookField>(
  (Object.entries(NAMES) as [BookField, string[]][]).flatMap(([field, names]) =>
    names.map((n): [string, BookField] => [n, field]),
  ),
);

/** has:cover  has:isbn  has:cover,isbn,rating  (every field listed must be there). Unknown names are ignored. */
export const hasFields: FieldDef[] = [
  {
    keys: ["has"],
    help: `has:${Object.keys(NAMES).join(" | ")}   a comma lists several: has:cover,isbn`,
    suggest: { summary: "fields that are filled in", values: HINTS, expand: true, multi: true },
    set: (f, v) => {
      for (const name of v.toLowerCase().split(/[,\s]+/)) {
        const field = BY_NAME.get(name);
        if (field && !f.has.includes(field)) f.has.push(field);
      }
    },
  },
];
