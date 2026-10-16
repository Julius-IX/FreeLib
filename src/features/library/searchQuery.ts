import type { BookFilter, ReadStatus } from "@/lib/types";
import { normTag } from "./book-form/inputs";

// The generated TS type has no optional fields, so every key must be present.
export function emptyFilter(): BookFilter {
  return {
    text: null,
    title: null,
    blurb: null,
    notes: null,
    author: null,
    tag: null,
    series: null,
    seriesId: null,
    authorIdsAny: [],
    tagIdsAny: [],
    tagIdsAll: [],
    tagIdsNone: [],
    publishFrom: null,
    publishTo: null,
    pageCountMin: null,
    pageCountMax: null,
    authorBirthFrom: null,
    authorBirthTo: null,
    authorDeathFrom: null,
    authorDeathTo: null,
    readStatus: null,
    startedFrom: null,
    startedTo: null,
    finishedFrom: null,
    finishedTo: null,
  };
}

const STATUS: Record<string, ReadStatus> = {
  unread: "unread",
  inprogress: "inProgress",
  reading: "inProgress",
  finished: "finished",
  read: "finished",
  done: "finished",
};

type Setter = (f: BookFilter, v: string) => void;

// Dates are sent to the backend as typed ("2024", "2024-03", "March 2024", ...);
// it expands partial dates to whole periods and ignores anything half-typed.

const INT = /^\d+$/;
const OP = /^(>=|<=|>|<|=)\s*(.*)$/;

/** Non-negative integer that survives the trip to an i64, else undefined. */
const toInt = (s: string): number | undefined =>
  INT.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined;

/**
 * "a..b", "a..", "..b", ">=a", "<=b", "=a" or a bare "a" -> [from, to].
 * A bare value is both bounds, so "2024" means "during 2024".
 * Strict ">" and "<" are not handled here (null).
 */
function parseRange(v: string): [from: string | null, to: string | null] | null {
  const s = v.trim();
  const dots = s.indexOf("..");
  if (dots >= 0) {
    const a = s.slice(0, dots).trim();
    const b = s.slice(dots + 2).trim();
    return a || b ? [a || null, b || null] : null;
  }
  const m = OP.exec(s);
  if (m) {
    const x = m[2].trim();
    if (!x) return null;
    if (m[1] === ">=") return [x, null];
    if (m[1] === "<=") return [null, x];
    if (m[1] === "=") return [x, x];
    return null;
  }
  return s ? [s, s] : null;
}

const dates =
  (set: (f: BookFilter, from: string | null, to: string | null) => void): Setter =>
    (f, v) => {
      const r = parseRange(v);
      if (r) set(f, r[0], r[1]);
    };

/** pages:300  pages:>300  pages:>=300  pages:<300  pages:100..300  pages:300..  pages:..300 */
const setPages: Setter = (f, v) => {
  const single = /^(>=|<=|>|<|=)?\s*(\d+)$/.exec(v.trim());
  if (single) {
    const n = toInt(single[2]);
    if (n === undefined) return;
    switch (single[1] ?? "=") {
      case ">": f.pageCountMin = n + 1; break;
      case ">=": f.pageCountMin = n; break;
      case "<": f.pageCountMax = n - 1; break;
      case "<=": f.pageCountMax = n; break;
      default: f.pageCountMin = n; f.pageCountMax = n;
    }
    return;
  }
  const r = parseRange(v);
  if (!r) return;
  const min = r[0] === null ? null : (toInt(r[0]) ?? NaN);
  const max = r[1] === null ? null : (toInt(r[1]) ?? NaN);
  if (Number.isNaN(min) || Number.isNaN(max)) return; // "pages:10..abc": ignore it all
  f.pageCountMin = min;
  f.pageCountMax = max;
};

/** "3,5 7" -> [3, 5, 7]. Any non-integer makes the whole value invalid (null). */
function parseIds(v: string): number[] | null {
  const parts = v.split(/[,\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const n = toInt(p);
    if (n === undefined) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

const idList =
  (set: (f: BookFilter, ids: number[]) => void): Setter =>
    (f, v) => {
      const ids = parseIds(v);
      if (ids) set(f, ids);
    };

// Keys are letters only (see KEY below). Add a searchable key = one `add` line.
//
//   text      title:  blurb:  notes:  author:  tag:  series:     substring, quote for spaces
//   status    status:unread | reading | finished
//   dates     published: (alias pub:, year:)   born:   died:   started:   finished:
//             2024 | 2024-03 | 2024-03-07 | "March 2024" | 1990..2000 | 1990.. | ..2000 | >=1990 | <=2000
//   pages     pages: (alias pagecount:)   300 | >300 | >=300 | <300 | <=300 | 100..300 | 300.. | ..300
//   ids       seriesid:3   authorid:1,2 (any)   tagid:4,5 (any)   tagall:4,5 (every)   tagnone:4,5 (none)

const FIELDS = new Map<string, Setter>();
const add = (keys: string[], setter: Setter) => keys.forEach((k) => FIELDS.set(k, setter));

add(["title"], (f, v) => { f.title = v; });
add(["blurb"], (f, v) => { f.blurb = v; });
add(["notes", "note"], (f, v) => { f.notes = v; });
add(["author"], (f, v) => { f.author = v; });
add(["tag"], (f, v) => { f.tag = normTag(v); });
add(["series"], (f, v) => { f.series = v; });
add(["status"], (f, v) => {
  f.readStatus = STATUS[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
});

add(["published", "pub", "year"], dates((f, a, b) => { f.publishFrom = a; f.publishTo = b; }));
add(["born"], dates((f, a, b) => { f.authorBirthFrom = a; f.authorBirthTo = b; }));
add(["died"], dates((f, a, b) => { f.authorDeathFrom = a; f.authorDeathTo = b; }));
add(["started"], dates((f, a, b) => { f.startedFrom = a; f.startedTo = b; }));
add(["finished"], dates((f, a, b) => { f.finishedFrom = a; f.finishedTo = b; }));

add(["pages", "pagecount"], setPages);

add(["seriesid"], (f, v) => {
  const ids = parseIds(v);
  if (ids?.length === 1) f.seriesId = ids[0];
});
add(["authorid"], idList((f, ids) => { f.authorIdsAny = ids; }));
add(["tagid"], idList((f, ids) => { f.tagIdsAny = ids; }));
add(["tagall"], idList((f, ids) => { f.tagIdsAll = ids; }));
add(["tagnone"], idList((f, ids) => { f.tagIdsNone = ids; }));

type Token = { key: string | null; value: string };

const KEY = /^([A-Za-z]+):/;
const isQuote = (c?: string) => c === "'" || c === '"';

// Reads a quoted run starting at s[i]. A quote only *closes* when followed by
// whitespace or end of input, so apostrophes inside ("Ender's Game") survive.
// Unterminated quotes take the rest of the string, so half-typed input works.
function readQuoted(s: string, i: number): [string, number] {
  const q = s[i];
  let j = i + 1;
  let out = "";
  while (j < s.length) {
    if (s[j] === q && (j + 1 === s.length || /\s/.test(s[j + 1]))) {
      return [out, j + 1];
    }
    out += s[j++];
  }
  return [out, j];
}

// "tag:foo" -> {tag, foo}. Unknown prefixes ("10:30", "https:...") stay free text.
function toToken(s: string): Token {
  const m = KEY.exec(s);
  const key = m?.[1].toLowerCase();
  if (m && key && FIELDS.has(key)) {
    return { key, value: s.slice(m[0].length).trim() };
  }
  return { key: null, value: s.trim() };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // 'tag:name with spaces'  or  'just some quoted text'
    if (isQuote(input[i])) {
      const [inner, next] = readQuoted(input, i);
      tokens.push(toToken(inner));
      i = next;
      continue;
    }

    // bare word, or key:'quoted value'
    let end = i;
    while (end < input.length && !/\s/.test(input[end])) end++;
    const word = input.slice(i, end);
    const m = KEY.exec(word);
    const key = m?.[1].toLowerCase();

    if (m && key && FIELDS.has(key) && isQuote(input[i + m[0].length])) {
      const [value, next] = readQuoted(input, i + m[0].length);
      tokens.push({ key, value: value.trim() });
      i = next;
    } else {
      tokens.push(toToken(word));
      i = end;
    }
  }

  return tokens;
}

export function parseQuery(input: string): BookFilter {
  const filter = emptyFilter();
  const free: string[] = [];

  for (const { key, value } of tokenize(input)) {
    if (!value) continue; // "tag:" while mid-typing
    if (key === null) free.push(value);
    else FIELDS.get(key)!(filter, value);
  }

  if (free.length) filter.text = free.join(" ");
  return filter;
}
