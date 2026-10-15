import type { BookDraft } from "../book-form/types";
import { isValidIsbn, normIsbn } from "../book-form/inputs";
import { sleep } from "@/util/async";

/** TODO: change after plugin backend is done
 * MOCK. None of this talks to anything yet.
 *
 * The real flow will be:   scanned code -> backend request -> plugin formats the response -> BookDraft
 * and this file is where those two middle steps get swapped in. `lookupBook` is the only export
 * the UI uses, so replacing `requestLookup` (backend call) and `formatResponse` (plugin) leaves
 * the scan screens untouched.
 */

/** Thrown for anything the user should be told about (shown as-is in a notification). */
export class LookupError extends Error { }

/** What a provider might send back. Provider-shaped, NOT our Book type: the plugin maps it. */
type RawLookupResponse = {
  isbn: string;
  title: string;
  authors: { name: string }[];
  subjects: string[];
  series: string | null; // "Name #3"
  published: string; // free-form provider date
  pages: number | null;
  description: string | null;
};

const MOCK_LATENCY_MS = 900;

/** MOCK backend request. Pretends the network took a moment and every valid ISBN is a hit. */
async function requestLookup(code: string): Promise<RawLookupResponse> {
  await sleep(MOCK_LATENCY_MS);
  const isbn = normIsbn(code);
  if (!isValidIsbn(isbn)) throw new LookupError(`"${code}" isn't an ISBN, so no book could be looked up`);
  return {
    isbn,
    title: "The Mock Lookup Chronicles",
    authors: [{ name: "Ada Placeholder" }, { name: "Sam Stubb" }],
    subjects: ["Fantasy", "Adventure"],
    series: "Mocked Realms #2",
    published: "March 7, 2004",
    pages: 412,
    description: "A simulated response, so the Add Book form has something to fill in.",
  };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "March 7, 2004" -> "2004-03-07". Anything it can't read becomes null (left blank in the form). */
function toIsoDate(text: string): string | null {
  const m = /^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(text.trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!m || month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** MOCK plugin: provider response -> the form's draft type. */
function formatResponse(raw: RawLookupResponse): BookDraft {
  const series = /^(.*?)\s*#(\d+(?:\.\d+)?)$/.exec(raw.series ?? "");
  return {
    title: raw.title,
    isbn: raw.isbn,
    authors: raw.authors.map((a) => ({ name: a.name })),
    tags: raw.subjects.map((name) => ({ name })),
    series: series ? { name: series[1] } : raw.series ? { name: raw.series } : null,
    seriesPosition: series ? Number(series[2]) : null,
    publishDate: toIsoDate(raw.published),
    pageCount: raw.pages,
    blurb: raw.description,
    cover: null, // no real image to download yet
  };
}

/** Scanned code -> a draft to prefill the Add Book form with. Rejects with a `LookupError`. */
export async function lookupBook(code: string): Promise<BookDraft> {
  return formatResponse(await requestLookup(code));
}
