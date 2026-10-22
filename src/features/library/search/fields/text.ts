import { normTag } from "../../book-form/inputs";
import type { FieldDef } from "./types";

/** Substring searches (case-insensitive, quote a value that has spaces) and the colour. */
export const textFields: FieldDef[] = [
  {
    keys: ["title"],
    help: "title:dune  words in the title",
    suggest: { summary: "words in the title" },
    set: (f, v) => { f.title = v; },
  },
  {
    keys: ["blurb"],
    help: "blurb:wizard  words in the blurb",
    suggest: { summary: "words in the blurb" },
    set: (f, v) => { f.blurb = v; },
  },
  {
    keys: ["notes", "note"],
    help: "notes:loved  words in your notes",
    suggest: { summary: "words in the notes" },
    set: (f, v) => { f.notes = v; },
  },
  {
    keys: ["author"],
    help: "author:herbert  one of the book's authors",
    suggest: { summary: "one of the authors" },
    set: (f, v) => { f.author = v; },
  },
  {
    keys: ["tag"],
    help: "tag:fantasy  one of the book's tags",
    suggest: { summary: "one of the tags" },
    set: (f, v) => { f.tag = normTag(v); },
  },
  {
    keys: ["series"],
    help: "series:earthsea  the series name",
    suggest: { summary: "the series name" },
    set: (f, v) => { f.series = v; },
  },
  {
    keys: ["category", "cat"],
    help: "category:owned  one of the book's categories",
    suggest: { summary: "one of the categories" },
    set: (f, v) => { f.category = v; },
  },
  {
    // sent as typed: the backend resolves CSS colour names (red) and normalises #FF0000 / ff0000 /
    // #f00, and ignores anything else (half-typed values)
    keys: ["color", "colour", "hex"],
    help: "color:red  a category with exactly this colour (a CSS name or hex). With category: the SAME category must match both",
    suggest: { summary: "a category with this colour" },
    set: (f, v) => { f.color = v; },
  },
];
