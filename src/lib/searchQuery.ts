import type { BookFilter, ReadStatus } from "@/lib/types";

// The generated TS type has no optional fields, so every key must be present.
export function emptyFilter(): BookFilter {
  return {
    text: null,
    title: null,
    blurb: null,
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

// Add a searchable key = add one line here.
const FIELDS = new Map<string, Setter>([
  ["title", (f, v) => { f.title = v; }],
  ["blurb", (f, v) => { f.blurb = v; }],
  ["author", (f, v) => { f.author = v; }],
  ["tag", (f, v) => { f.tag = v; }],
  ["series", (f, v) => { f.series = v; }],
  [
    "status",
    (f, v) => {
      f.readStatus = STATUS[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
    },
  ],
]);

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
