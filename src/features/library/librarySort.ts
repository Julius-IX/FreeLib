import { useCallback } from "react";
import { setSetting, useSetting } from "@/lib/settings";
import type { BookSort, SortDir, SortKey } from "@/lib/types";

/**
 * Menu label and starting direction for every sort key. A Record, so adding a `SortKey` on the
 * Rust side is a type error here until it gets a label. Menu order = key order below.
 *
 * Starting direction is the useful one: A to Z for names, newest / biggest / most first for the rest.
 */
export const SORT_INFO: Record<SortKey, { label: string; dir: SortDir }> = {
  title: { label: "Title", dir: "asc" },
  author: { label: "Author", dir: "asc" },
  series: { label: "Series", dir: "asc" },
  category: { label: "Category", dir: "asc" },
  added: { label: "Date added", dir: "desc" },
  published: { label: "Publish date", dir: "desc" },
  pages: { label: "Page count", dir: "desc" },
  lastRead: { label: "Last read", dir: "desc" },
  timesRead: { label: "Times read", dir: "desc" },
};

export const SORT_KEYS = Object.keys(SORT_INFO) as SortKey[];

// One shared object: `useSetting` hands the fallback back by reference, so it must not change.
export const DEFAULT_SORT: BookSort = { by: "title", dir: "asc" };

const KEY = "librarySort";

const isBookSort = (v: unknown): v is BookSort => {
  if (typeof v !== "object" || v === null) return false;
  const { by, dir } = v as Record<string, unknown>;
  return SORT_KEYS.includes(by as SortKey) && (dir === "asc" || dir === "desc");
};

/** The library's sort order, saved between launches. */
export function useLibrarySort() {
  const [sort] = useSetting<BookSort>(KEY, DEFAULT_SORT, isBookSort);
  const save = useCallback((s: BookSort) => setSetting(KEY, s), []);
  return [sort, save] as const;
}
