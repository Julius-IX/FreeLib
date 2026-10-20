import type { BookField } from "@/lib/types";
import type { FieldDef } from "./types";

// What you can type after `has:`, and the field each name stands for. The first name of each
// group is the main one; the rest are what people tend to type.
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
    set: (f, v) => {
      for (const name of v.toLowerCase().split(/[,\s]+/)) {
        const field = BY_NAME.get(name);
        if (field && !f.has.includes(field)) f.has.push(field);
      }
    },
  },
];
