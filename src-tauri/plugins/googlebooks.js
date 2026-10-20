// Built-in plugin: Google Books (https://developers.google.com/books).
//
// Fills (when Google has them): title, publishDate, pageCount, authors, tags, blurb, cover.
// Google doesn't name a book's series, so series / seriesPosition are left to other plugins.
//
// API KEY. Requests without a key share one anonymous Google project, and its daily quota is
// usually used up ("Quota exceeded ... quota_limit_value 0"). A personal key avoids this (free, 1,000
// requests a day by default):
//   1. console.cloud.google.com -> create a project -> "APIs & Services" -> enable "Books API"
//      -> "Credentials" -> "Create credentials" -> "API key".
//   2. Give it to the app, either
//        - in the app: Plugins tab -> the settings button next to Google Books -> { "apiKey": "your-key" }
//          (saved in <app data dir>/plugins/googlebooks.config.json)
//        - when building:   GOOGLE_BOOKS_API_KEY=your-key cargo tauri dev   (also for release / Android builds)
//      The saved settings win over the build-time value.
// Without a key the plugin still tries, and fails with a message saying so if Google refuses.
const manifest = {
  id: "googlebooks",
  name: "Google Books",
  version: "1.1.0",
  permissions: { http: ["www.googleapis.com"] },
  configExample: { apiKey: "your-key" },
};

const MAX_TAGS = 3;

// Google returns HTML in `description` (<p>, <br>, <b>, ...) and HTML entities.
function stripHtml(html) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Categories look like "Juvenile Fiction / Fantasy & Magic": keep each meaningful part.
function toTags(categories) {
  const out = [];
  for (const c of categories || []) {
    for (const part of String(c).split("/")) {
      const t = part.trim();
      if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out.slice(0, MAX_TAGS);
}

// What went wrong, from Google's error body ({ error: { code, message, status, errors: [{ reason }] } }).
function apiFailure(res, hasKey) {
  let reason = "", message = "";
  try {
    const e = JSON.parse(res.body).error;
    reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || "";
    message = e.message || "";
  } catch { /* not JSON: fall through to the generic message */ }

  if (res.status === 429 || /rateLimit|quota|dailyLimit/i.test(reason)) {
    return new PluginError("http", hasKey
      ? "Google Books quota exceeded for the API key (it resets daily)"
      : "Google Books has no free quota for requests without an API key right now. Add your own key: see the top of src-tauri/plugins/googlebooks.js");
  }
  if (res.status === 400 && /api[ _]?key/i.test(`${reason} ${message}`)) {
    return new PluginError("http", "Google Books rejected the API key");
  }
  if (res.status === 403) {
    return new PluginError("http", `Google Books refused the request (${reason || 403}). Is the Books API enabled for the key's project?`);
  }
  return new PluginError("http", `server returned ${res.status}${message ? `: ${message.slice(0, 120)}` : ""}`);
}

plugin.register(({ isbn }, http, config) => {
  const key = config && config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : "";
  const res = http.get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1${key}`);
  if (!res.ok) throw apiFailure(res, key !== "");

  let json;
  try { json = JSON.parse(res.body); }
  catch { throw new PluginError("parse", "response was not JSON"); }

  const item = json.items && json.items[0];
  if (!item || !item.volumeInfo) throw new PluginError("not_found", `no book with ISBN ${isbn}`);
  const v = item.volumeInfo;

  // thumbnails come back as http:// links, the same URL works over https
  const images = v.imageLinks || {};
  const thumb = images.extraLarge || images.large || images.medium || images.thumbnail || images.smallThumbnail;
  const cover = thumb ? thumb.replace(/^http:/, "https:").replace("&edge=curl", "") : undefined;

  const tags = toTags(v.categories);

  return {
    title: v.title ? (v.subtitle ? `${v.title}: ${v.subtitle}` : v.title) : undefined,
    publishDate: v.publishedDate, // the host turns this into YYYY-MM-DD, or rejects a bare year
    pageCount: v.pageCount > 0 ? v.pageCount : undefined,
    authors: v.authors && v.authors.length ? v.authors : undefined,
    tags: tags.length ? tags : undefined,
    blurb: v.description ? stripHtml(v.description) : undefined,
    cover,
  };
});
