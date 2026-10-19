import { toChoice, toChoices } from "./choice";
import type { BookDraft, BookFields, Choice } from "./types";

/**
 * Re-running the lookup plugins from the form (for when a book can't be scanned, or the first
 * lookup missed things). The result is merged into what is already in the form with one rule:
 * only fields that are still empty are filled. Nothing the user typed or a previous lookup
 * filled in is ever replaced. The only field that can grow is the tags, which gain the ones
 * that aren't there yet.
 */

/** The parts of the form a lookup can change. */
export type FormSnapshot = {
  fields: BookFields;
  authors: Choice[];
  tags: Choice[];
  series: Choice | null;
  cover: string;
  dateText: string;
};

/** What to change (only the keys that changed) and what to call it when telling the user. */
export type LookupMerge = {
  fields: Partial<BookFields>;
  authors?: Choice[];
  tags?: Choice[];
  series?: Choice;
  cover?: string;
  dateText?: string;
  /** Human labels of what was filled in, in form order. Empty = nothing new was found. */
  filled: string[];
};

const blank = (s: string | null | undefined) => !s || s.trim() === "";
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function mergeLookup(current: FormSnapshot, found: BookDraft): LookupMerge {
  const fields: Partial<BookFields> = {};
  const out: LookupMerge = { fields, filled: [] };

  if (blank(current.fields.title) && !blank(found.title)) {
    fields.title = found.title!.trim();
    out.filled.push("title");
  }

  if (current.authors.length === 0) {
    const authors = toChoices(found.authors);
    if (authors.length > 0) {
      out.authors = authors;
      out.filled.push("authors");
    }
  }

  // Series: the name only if there is none yet. The position when it is empty and the series
  // (new or already chosen) is the one the lookup is talking about.
  let seriesName = current.series?.name ?? null;
  if (!current.series && found.series && !blank(found.series.name)) {
    out.series = toChoice(found.series);
    seriesName = out.series.name;
    out.filled.push("series");
  }
  if (
    seriesName &&
    found.series &&
    sameName(seriesName, found.series.name) &&
    current.fields.seriesPosition === null &&
    found.seriesPosition != null
  ) {
    fields.seriesPosition = found.seriesPosition;
    if (!out.filled.includes("series")) out.filled.push("series position");
  }

  const newTags = toChoices(found.tags).filter(
    (t) => !current.tags.some((existing) => sameName(existing.name, t.name)),
  );
  if (newTags.length > 0) {
    out.tags = [...current.tags, ...newTags];
    out.filled.push("tags");
  }

  if (current.fields.pageCount === null && found.pageCount != null && found.pageCount > 0) {
    fields.pageCount = found.pageCount;
    out.filled.push("pages");
  }

  if (blank(current.cover) && !blank(found.cover)) {
    out.cover = found.cover!.trim();
    out.filled.push("cover");
  }

  if (blank(current.dateText) && !blank(found.publishDate)) {
    out.dateText = found.publishDate!.trim();
    out.filled.push("publish date");
  }

  if (blank(current.fields.blurb) && !blank(found.blurb)) {
    fields.blurb = found.blurb!.trim();
    out.filled.push("blurb");
  }

  return out;
}
