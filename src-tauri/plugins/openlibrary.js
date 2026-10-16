// Built-in plugin: Open Library (https://openlibrary.org). Needs no API key.
//
// Fills (when Open Library has them): title, publishDate, pageCount, authors, tags, series,
// seriesPosition, blurb, cover. Everything it can't fill is left out; the app reports it as `missing`.
const manifest = {
  id: "openlibrary",
  name: "Open Library",
  version: "1.0.0",
  permissions: { http: ["openlibrary.org"] },
  ignoreConfig: true, // needs no settings: anything saved for it in the Plugins tab is never passed on
};

const MAX_TAGS = 5;
// Open Library subjects include housekeeping entries ("Accessible book", "nyt:hardcover-fiction=...")
const JUNK_SUBJECT = /^(accessible book|protected daisy|in library|large type books|lending library|internet archive wishlist|overdrive|reading level|nyt:|series:|place:|time:|people:)/i;

// An edition's `series` entries look like "Harry Potter, 3", "Discworld ; 1" or "Dune (Book 2)".
function parseSeries(entry) {
  const m = /^(.*?)[\s,;:#(]*(?:book|bk|vol(?:ume)?|no|number|part)?\.?\s*#?\s*(\d+(?:\.\d+)?)\)?\s*$/i.exec(entry.trim());
  if (m && m[1].trim()) return { name: m[1].trim(), position: Number(m[2]) };
  return { name: entry.trim(), position: undefined };
}

// `description` is a string, or { type, value }.
function text(d) {
  if (!d) return undefined;
  const s = typeof d === "string" ? d : d.value;
  return s ? s.trim() : undefined;
}

// Some imported records put MARC housekeeping in `description`, e.g. "246 pages : 22 cm".
// That's a physical description, not a blurb.
const PHYSICAL_DESCRIPTION = /^\s*(\[?\d+\]?\s*(pages?|p\.?|leaves|volumes?)\b|xi*v*i*x*,?\s*\d+\s*p)|\b\d+\s*(cm|mm|in\.?)\s*$/i;
function blurbText(d) {
  const t = text(d);
  return t && !PHYSICAL_DESCRIPTION.test(t) ? t : undefined;
}

// Subjects like "Comics & graphic novels, fantasy" are really two tags glued together.
function splitSubject(s) {
  return s.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
}

// "Kugane Maruyama ; illustration by so-bin" -> ["Kugane Maruyama"]. Last resort for records
// that have no linked author records.
function authorsFromStatement(stmt) {
  if (!stmt) return [];
  const main = String(stmt).split(/\s*;\s*/)[0].replace(/^by\s+/i, "");
  return main.split(/\s*(?:,|&|\band\b)\s*/i).map((n) => n.trim()).filter(Boolean);
}

function getJson(http, url) {
  const res = http.get(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new PluginError("http", `${url} returned ${res.status}`);
  try { return JSON.parse(res.body); }
  catch { throw new PluginError("parse", `${url} did not return JSON`); }
}

plugin.register(({ isbn }, http) => {
  // redirects to the edition record (/books/OL...M.json); the host follows and checks them
  const edition = getJson(http, `https://openlibrary.org/isbn/${isbn}.json`);
  if (!edition) throw new PluginError("not_found", `no book with ISBN ${isbn}`);

  // the description and subjects live on the work, not the edition
  let work = null;
  const workKey = edition.works && edition.works[0] && edition.works[0].key;
  if (workKey) {
    try { work = getJson(http, `https://openlibrary.org${workKey}.json`); }
    catch (e) { plugin.log(`work ${workKey}: ${e.message}`); }
  }

  // authors are only links to other records. Imported editions often have none, in which case
  // the work's author list or the "by" statement is the only source.
  const authorKeys = [];
  for (const a of edition.authors || []) if (a.key) authorKeys.push(a.key);
  if (!authorKeys.length && work) {
    for (const a of work.authors || []) {
      const key = (a.author && a.author.key) || a.key;
      if (key) authorKeys.push(key);
    }
  }
  const authors = [];
  for (const key of authorKeys) {
    try {
      const rec = getJson(http, `https://openlibrary.org${key}.json`);
      if (rec && rec.name) authors.push(rec.name);
    } catch (e) {
      plugin.log(`author ${key}: ${e.message}`);
    }
  }
  if (!authors.length) authors.push(...authorsFromStatement(edition.by_statement));

  const blurb = blurbText(edition.description) || (work && blurbText(work.description));

  const subjects = (work && work.subjects) || edition.subjects || [];
  // Cap the subject headings, not the resulting tags: splitting "A, b" into two tags must not
  // push a real subject out.
  const headings = subjects.filter((s) => typeof s === "string" && !JUNK_SUBJECT.test(s)).slice(0, MAX_TAGS);
  const tags = [];
  for (const heading of headings) {
    for (const t of splitSubject(heading)) {
      if (!tags.some((o) => o.toLowerCase() === t.toLowerCase())) tags.push(t);
    }
  }

  const series = edition.series && edition.series[0] ? parseSeries(String(edition.series[0])) : undefined;

  const coverId = edition.covers && edition.covers.find((id) => id > 0);

  return {
    title: edition.title ? (edition.subtitle ? `${edition.title}: ${edition.subtitle}` : edition.title) : undefined,
    publishDate: edition.publish_date, // the host turns "March 7, 2004" into 2004-03-07 (or rejects a bare year)
    pageCount: edition.number_of_pages,
    authors: authors.length ? authors : undefined,
    tags: tags.length ? tags : undefined,
    series: series && series.name,
    seriesPosition: series && series.position,
    blurb,
    cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
  };
});
