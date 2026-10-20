// Built-in plugin: Inventaire (https://inventaire.io). Needs no API key.
//
// Fills title, publishDate, pageCount, authors, tags, series, seriesPosition and cover.
// Inventaire has no blurb.
//
// Inventaire shares its data model with Wikidata. An edition (the entity with the ISBN) only links
// to a work, and the work links to authors, series and genres. That takes three requests to
// /api/entities/by-uris: the edition, its works, then the names of everything they link to.
//
// Inventaire rate-limits clients that send no User-Agent with contact details. Plugins can't set
// headers, so an HTTP 429 is most likely that.
const manifest = {
  id: "inventaire",
  name: "Inventaire",
  version: "1.0.0",
  permissions: { http: ["inventaire.io"] },
  ignoreConfig: true,
};

const ORIGIN = "https://inventaire.io";
const MAX_WORKS = 3; // an edition can bundle several works, more than a few is a box set
const MAX_AUTHORS = 8;
const MAX_TAGS = 5;
// label languages in order of preference, any other language is the last resort
const LANGS = ["en", "mul", "fr", "de", "es", "it", "nl", "pt"];

const AUTHOR = "wdt:P50";
// comics and manga have a scenarist and an illustrator instead of an author
const CREATOR_FALLBACK = ["wdt:P58", "wdt:P110"];

const isUri = (s) => typeof s === "string" && /^(wd|inv):/.test(s);

function unique(list) {
  const out = [];
  for (const x of list) if (!out.includes(x)) out.push(x);
  return out;
}

// claims look like { "wdt:P1476": ["Title"], "wdt:P629": ["wd:Q..."] }
function claim(entity, property) {
  const values = entity && entity.claims && entity.claims[property];
  return Array.isArray(values) ? values : [];
}

function labelOf(entity) {
  const labels = (entity && entity.labels) || {};
  for (const lang of LANGS) if (labels[lang]) return String(labels[lang]).trim();
  const any = Object.keys(labels)[0];
  return any && labels[any] ? String(labels[any]).trim() : undefined;
}

function getJson(http, url) {
  const res = http.get(url);
  if (res.status === 404) return null;
  if (res.status === 429) {
    throw new PluginError("http", "Inventaire is rate-limiting this app (HTTP 429). Try again in a while");
  }
  if (!res.ok) throw new PluginError("http", `${url} returned ${res.status}`);
  try { return JSON.parse(res.body); }
  catch { throw new PluginError("parse", `${url} did not return JSON`); }
}

// Fetches all the entities in one request and returns a lookup from uri to entity. Merged entities
// are only reachable through `redirects`.
function fetchEntities(http, uris) {
  // "|" separates the uris, the ":" stays readable
  const query = encodeURIComponent(uris.join("|")).replace(/%3A/gi, ":");
  const json = getJson(http, `${ORIGIN}/api/entities/by-uris?uris=${query}`) || {};
  const entities = json.entities || {};
  const redirects = json.redirects || {};
  return (uri) => {
    const found = entities[redirects[uri] || uri];
    if (found) return found;
    // an ISBN comes back under the entity's own uri, not the "isbn:" one that was asked for
    const keys = Object.keys(entities);
    return uris.length === 1 && keys.length === 1 ? entities[keys[0]] : undefined;
  };
}

function coverOf(edition) {
  const hash = claim(edition, "invp:P2")[0]; // image hash in Inventaire's own store
  if (hash) return `${ORIGIN}/img/entities/${hash}`;
  const image = edition.image;
  const url = image && (typeof image === "string" ? image : image.url);
  if (typeof url !== "string" || !url) return undefined;
  return url.startsWith("/") ? `${ORIGIN}${url}` : url;
}

plugin.register(({ isbn }, http) => {
  const editionUri = `isbn:${isbn}`;
  const edition = fetchEntities(http, [editionUri])(editionUri);
  if (!edition) throw new PluginError("not_found", `no book with ISBN ${isbn}`);

  // a failed works request only costs authors, series and tags, so the rest is still returned
  let works = [];
  const workUris = unique(claim(edition, "wdt:P629").filter(isUri)).slice(0, MAX_WORKS);
  if (workUris.length) {
    try {
      const get = fetchEntities(http, workUris);
      works = workUris.map(get).filter(Boolean);
    } catch (e) {
      plugin.log(`works: ${e.message}`);
    }
  }

  // a bundle has several works, so authors are collected from all of them
  let authorUris = [];
  for (const work of works) authorUris.push(...claim(work, AUTHOR).filter(isUri));
  if (!authorUris.length) {
    for (const work of works) {
      for (const property of CREATOR_FALLBACK) authorUris.push(...claim(work, property).filter(isUri));
    }
  }
  authorUris = unique(authorUris).slice(0, MAX_AUTHORS);

  // editions are sometimes linked to a series directly, so they are checked last
  let seriesUri, seriesPosition;
  for (const holder of [...works, edition]) {
    const uri = claim(holder, "wdt:P179").find(isUri);
    if (!uri) continue;
    seriesUri = uri;
    const m = /\d+(?:\.\d+)?/.exec(String(claim(holder, "wdt:P1545")[0] || ""));
    if (m) seriesPosition = Number(m[0]);
    break;
  }

  const genreUris = [];
  for (const work of works) genreUris.push(...claim(work, "wdt:P136").filter(isUri));

  // authors, series and genres are only links so far, their names take one more request
  const nameUris = unique([...authorUris, ...(seriesUri ? [seriesUri] : []), ...genreUris]);
  let nameOf = () => undefined;
  if (nameUris.length) {
    try {
      const get = fetchEntities(http, nameUris);
      nameOf = (uri) => labelOf(get(uri));
    } catch (e) {
      plugin.log(`labels: ${e.message}`);
    }
  }
  const names = (uris) => unique(uris.map(nameOf).filter(Boolean));

  const authors = names(authorUris);
  const tags = names(genreUris).slice(0, MAX_TAGS);
  const series = seriesUri ? nameOf(seriesUri) : undefined;

  const title = claim(edition, "wdt:P1476")[0] || labelOf(edition);
  const subtitle = claim(edition, "wdt:P1680")[0];
  const pages = Number(claim(edition, "wdt:P1104")[0]);

  return {
    title: title ? (subtitle ? `${title}: ${subtitle}` : title) : undefined,
    publishDate: claim(edition, "wdt:P577")[0],
    pageCount: Number.isInteger(pages) && pages > 0 ? pages : undefined,
    authors: authors.length ? authors : undefined,
    tags: tags.length ? tags : undefined,
    series,
    seriesPosition: series ? seriesPosition : undefined,
    cover: coverOf(edition),
  };
});
