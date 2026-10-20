import type { ReadStatus, StatsGroup, StatsMeasure } from "@/lib/types";

export type ChartKind = "bar" | "column" | "line" | "donut";

/** The question as it is filled in on screen. `toQuery` turns it into what the backend takes. */
export type StatsForm = {
  measure: StatsMeasure;
  groupBy: StatsGroup;
  /** `null` is the first chart kind that suits the question. */
  chart: ChartKind | null;
  /** Rows to keep for groups ordered by size. `null` keeps all of them. */
  limit: number | null;
  includeEmpty: boolean;
  status: ReadStatus | null;
  shelfIds: number[];
  categoryIds: number[];
  tagIds: number[];
  /** The library's search syntax, so every key it knows works here too. */
  search: string;
};

export const defaultForm = (): StatsForm => ({
  measure: "books",
  groupBy: "finishedYear",
  chart: null,
  limit: 10,
  includeEmpty: false,
  status: null,
  shelfIds: [],
  categoryIds: [],
  tagIds: [],
  search: "",
});

export const MEASURES: { id: StatsMeasure; label: string; short: string; unit: string }[] = [
  { id: "books", label: "Number of books", short: "Books", unit: "books" },
  { id: "pages", label: "Total pages", short: "Pages", unit: "pages" },
  { id: "avgRating", label: "Average rating", short: "Average rating", unit: "/ 10" },
  { id: "avgPages", label: "Average page count", short: "Average pages", unit: "pages" },
];

type GroupInfo = {
  id: StatsGroup;
  label: string;
  /** Reads after "by" in the title: "Books by author". */
  by: string;
  /** Chart kinds that suit it, the first is the default. */
  kinds: ChartKind[];
  /** Whether the backend orders it by size, which is when a limit applies. */
  bySize: boolean;
};

const SIZED: ChartKind[] = ["bar", "donut"];
const AXIS: ChartKind[] = ["column", "line", "bar"];

export const GROUPS: GroupInfo[] = [
  { id: "finishedYear", label: "Year finished", by: "year finished", kinds: AXIS, bySize: false },
  { id: "finishedMonth", label: "Month finished", by: "month finished", kinds: AXIS, bySize: false },
  { id: "publishYear", label: "Publish year", by: "publish year", kinds: AXIS, bySize: false },
  { id: "publishDecade", label: "Publish decade", by: "publish decade", kinds: AXIS, bySize: false },
  { id: "addedMonth", label: "Month added", by: "month added", kinds: AXIS, bySize: false },
  { id: "readStatus", label: "Reading status", by: "reading status", kinds: ["donut", "bar"], bySize: true },
  { id: "author", label: "Author", by: "author", kinds: SIZED, bySize: true },
  { id: "tag", label: "Tag", by: "tag", kinds: SIZED, bySize: true },
  { id: "category", label: "Category", by: "category", kinds: SIZED, bySize: true },
  { id: "shelf", label: "Shelf", by: "shelf", kinds: SIZED, bySize: true },
  { id: "series", label: "Series", by: "series", kinds: SIZED, bySize: true },
  { id: "rating", label: "Rating", by: "rating", kinds: AXIS, bySize: false },
  { id: "pageCount", label: "Page count", by: "page count", kinds: AXIS, bySize: false },
];

/** Why the numbers of a grouping can add up to more than the library holds. */
export const NOTES: Partial<Record<StatsGroup, string>> = {
  author: "A book with several authors counts for each of them.",
  tag: "A book with several tags counts for each of them.",
  category: "A book in several categories counts for each of them.",
  shelf: "A book on several shelves counts for each of them.",
  finishedYear: "Rereads count once for every time a book was finished.",
  finishedMonth: "Rereads count once for every time a book was finished.",
};

export const groupInfo = (id: StatsGroup) => GROUPS.find((g) => g.id === id)!;
export const measureInfo = (id: StatsMeasure) => MEASURES.find((m) => m.id === id)!;

const isAverage = (m: StatsMeasure) => m === "avgRating" || m === "avgPages";

/** A donut shows shares of a whole, which an average isn't. */
export function chartKinds(groupBy: StatsGroup, measure: StatsMeasure): ChartKind[] {
  const kinds = groupInfo(groupBy).kinds;
  return isAverage(measure) ? kinds.filter((k) => k !== "donut") : kinds;
}

/** The chart that is shown: the chosen one if it still suits the question, else the default. */
export function activeChart(form: StatsForm): ChartKind {
  const kinds = chartKinds(form.groupBy, form.measure);
  return form.chart && kinds.includes(form.chart) ? form.chart : kinds[0];
}

export const CHART_LABELS: Record<ChartKind, string> = {
  bar: "Bars",
  column: "Columns",
  line: "Line",
  donut: "Donut",
};

/** One tap to a common question. Only the question changes, the filters stay as they are. */
export const PRESETS: { label: string; set: Partial<StatsForm> }[] = [
  { label: "Books per year", set: { measure: "books", groupBy: "finishedYear", chart: null } },
  { label: "Pages per month", set: { measure: "pages", groupBy: "finishedMonth", chart: null } },
  { label: "Top authors", set: { measure: "books", groupBy: "author", chart: null, limit: 10 } },
  { label: "Best rated tags", set: { measure: "avgRating", groupBy: "tag", chart: null, limit: 10 } },
  { label: "Ratings given", set: { measure: "books", groupBy: "rating", chart: null } },
  { label: "By decade", set: { measure: "books", groupBy: "publishDecade", chart: null } },
  { label: "Reading status", set: { measure: "books", groupBy: "readStatus", chart: null } },
];
