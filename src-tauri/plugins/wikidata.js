// Built-in plugin: Wikidata (https://www.wikidata.org), through its SPARQL endpoint. Needs no API key.
//
// Fills title, publishDate, pageCount, authors, tags, series, seriesPosition and cover.
// Wikidata has no blurb.
//
// Wikidata only has the books somebody added, so many ISBNs are not found. This plugin is meant
// as a fallback behind the others.
//
// A single SPARQL request does everything, with two workarounds:
// - Wikidata stores ISBNs with hyphens ("978-1-58567-677-4") and a scan has none. Placing the
//   hyphens correctly needs the ISBN agency's range table, so every plausible placement is
//   tried at once in a VALUES list. The wrong ones match nothing and the lookup stays an index hit.
// - Wikidata stores the year "2005" as 2005-01-01 with a lower precision. Without checking the
//   precision it would read as a real January 1st.
//
// The Wikimedia User-Agent policy asks for contact details, which plugins can't set. An HTTP 403
// or 429 from the query service is most likely that.
const manifest = {
  id: "wikidata",
  name: "Wikidata",
  version: "1.0.0",
  permissions: { http: ["query.wikidata.org"] },
  ignoreConfig: true,
};

const ENDPOINT = "https://query.wikidata.org/sparql";
const MAX_TAGS = 5;
// label languages in order of preference ("mul" is the language-neutral label)
const LABEL_LANGS = "en,mul,fr,de,es,it,nl,pt";
const DAY_PRECISION = 11; // wikibase:timePrecision, 9 is a year and 10 a month
const COVER_WIDTH = 600;

// SECTION: ISBN

function checkDigit13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

function checkDigit10(first9) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? "X" : String(check);
}

// items carry the ISBN-13 (P212), the ISBN-10 (P957) or both
function bothForms(isbn) {
  if (isbn.length === 10) {
    const core = `978${isbn.slice(0, 9)}`;
    return [isbn, core + checkDigit13(core)];
  }
  const nine = isbn.slice(3, 12);
  return isbn.startsWith("978") ? [isbn, nine + checkDigit10(nine)] : [isbn];
}

// Every way to hyphenate an ISBN as [prefix-]group-publisher-title-check. The group has 1-5 digits,
// the publisher and the title 1-7 each, sharing the 9 digits between the prefix and the check.
function hyphenations(isbn) {
  const thirteen = isbn.length === 13;
  const prefix = thirteen ? `${isbn.slice(0, 3)}-` : "";
  const body = thirteen ? isbn.slice(3, 12) : isbn.slice(0, 9);
  const check = isbn[isbn.length - 1];
  const out = [];
  for (let group = 1; group <= 5; group++) {
    for (let publisher = 1; publisher <= 7; publisher++) {
      const title = 9 - group - publisher;
      if (title < 1 || title > 7) continue;
      out.push(`${prefix}${body.slice(0, group)}-${body.slice(group, group + publisher)}-${body.slice(group + publisher)}-${check}`);
    }
  }
  return out;
}

function candidates(isbn) {
  const out = [];
  for (const form of bothForms(isbn)) out.push(form, ...hyphenations(form));
  return out;
}

// SECTION: query

// A path like (wdt:P50|wdt:P629/wdt:P50) reads "the edition's author, or its work's author". Data
// is often only on the work. Every path starts from the edition already matched, so they stay cheap.
function buildQuery(isbn) {
  const values = candidates(isbn).map((c) => `"${c}"`).join(" ");
  return [
    "SELECT ?title ?subtitle ?date ?prec ?pages ?image ?seriesLabel ?ordinal",
    '(GROUP_CONCAT(DISTINCT ?authorLabel;SEPARATOR="|") AS ?authors)',
    '(GROUP_CONCAT(DISTINCT ?genreLabel;SEPARATOR="|") AS ?genres)',
    "WHERE{",
    `VALUES ?isbn{${values}}`,
    "?edition (wdt:P212|wdt:P957) ?isbn.",
    "OPTIONAL{?edition wdt:P1476 ?title}",
    "OPTIONAL{?edition wdt:P1680 ?subtitle}",
    "OPTIONAL{?edition p:P577/psv:P577 ?time. ?time wikibase:timeValue ?date; wikibase:timePrecision ?prec}",
    "OPTIONAL{?edition wdt:P1104 ?pages}",
    "OPTIONAL{?edition (wdt:P18|wdt:P629/wdt:P18) ?image}",
    "OPTIONAL{?edition (wdt:P50|wdt:P629/wdt:P50) ?author}",
    "OPTIONAL{?edition (wdt:P136|wdt:P629/wdt:P136) ?genre}",
    "OPTIONAL{?edition (p:P179|wdt:P629/p:P179) ?membership. ?membership ps:P179 ?series. OPTIONAL{?membership pq:P1545 ?ordinal}}",
    `SERVICE wikibase:label{bd:serviceParam wikibase:language "${LABEL_LANGS}"}`,
    "}",
    "GROUP BY ?title ?subtitle ?date ?prec ?pages ?image ?seriesLabel ?ordinal",
    "LIMIT 5",
  ].join(" ");
}

// SECTION: reading the answer

function value(row, name) {
  const cell = row[name];
  return cell && cell.value !== "" ? cell.value : undefined;
}

// Several items can share an ISBN (duplicates, a Wikisource copy), so the most complete row wins.
function mostComplete(rows) {
  const names = ["title", "date", "pages", "image", "authors", "genres", "seriesLabel"];
  let best = rows[0], bestScore = -1;
  for (const row of rows) {
    const score = names.filter((n) => value(row, n)).length;
    if (score > bestScore) { best = row; bestScore = score; }
  }
  return best;
}

// the label service answers with the item id ("Q42") when no wanted language has a label
const isEntityId = (s) => /^Q\d+$/.test(s);

function names(joined) {
  const out = [];
  for (const name of (joined || "").split("|")) {
    const n = name.trim();
    if (n && !isEntityId(n) && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// P18 is a Commons file link, a width is requested because the original can be huge
function coverOf(url) {
  if (!url) return undefined;
  const https = url.replace(/^http:/, "https:");
  return /Special:FilePath\//.test(https) ? `${https}?width=${COVER_WIDTH}` : https;
}

plugin.register(({ isbn }, http) => {
  const digits = String(isbn).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (digits.length !== 10 && digits.length !== 13) {
    throw new PluginError("parse", `${isbn} is not an ISBN-10 or ISBN-13`);
  }

  const res = http.get(`${ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery(digits))}`);
  if (res.status === 403 || res.status === 429) {
    throw new PluginError("http", `Wikidata refused the request (HTTP ${res.status}). It rate-limits clients that send no contact details in the User-Agent; try again later`);
  }
  if (!res.ok) throw new PluginError("http", `Wikidata returned ${res.status}${res.body ? `: ${String(res.body).slice(0, 120)}` : ""}`);

  let rows;
  try { rows = JSON.parse(res.body).results.bindings; }
  catch { throw new PluginError("parse", "Wikidata did not return SPARQL JSON"); }
  if (!rows || !rows.length) throw new PluginError("not_found", `no book with ISBN ${isbn}`);

  const row = mostComplete(rows);

  const title = value(row, "title");
  const subtitle = value(row, "subtitle");

  // a date below day precision is padded by Wikidata and not real
  const date = value(row, "date");
  const publishDate = date && Number(value(row, "prec")) >= DAY_PRECISION ? date.slice(0, 10) : undefined;

  const pages = Math.round(Number(value(row, "pages")));
  const authors = names(value(row, "authors"));
  const tags = names(value(row, "genres")).map(capitalize).slice(0, MAX_TAGS);

  const seriesName = value(row, "seriesLabel");
  const series = seriesName && !isEntityId(seriesName) ? seriesName : undefined;
  const ordinal = /\d+(?:\.\d+)?/.exec(value(row, "ordinal") || "");

  return {
    title: title ? (subtitle ? `${title}: ${subtitle}` : title) : undefined,
    publishDate,
    pageCount: pages > 0 ? pages : undefined,
    authors: authors.length ? authors : undefined,
    tags: tags.length ? tags : undefined,
    series,
    seriesPosition: series && ordinal ? Number(ordinal[0]) : undefined,
    cover: coverOf(value(row, "image")),
  };
});
