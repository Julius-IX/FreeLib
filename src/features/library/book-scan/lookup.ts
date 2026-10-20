import { commands } from "@/lib/commands";
import type { BookInfo, LookupOutcome } from "@/lib/types";
import type { BookDraft } from "../book-form/types";
import { isValidIsbn, normIsbn, normTag } from "../book-form/inputs";

/**
 * Scanned code -> backend -> every lookup plugin (Open Library, Google Books, ...) -> merged
 * -> a `BookDraft` for the Add Book form. The merging happens in Rust (src-tauri/src/plugins.rs).
 * This file only turns its answer into the form's draft type and into a message for the user.
 */

/** Thrown for anything the user should be told about (shown as-is in a notification). */
export class LookupError extends Error { }

/** The plugins' book properties -> the form's draft. Authors, tags and series arrive as names. */
export function toDraft(info: BookInfo, isbn: string): BookDraft {
  return {
    title: info.title ?? undefined,
    isbn, // always the code that was scanned, whatever the plugins say
    authors: info.authors?.map((name) => ({ name })),
    tags: info.tags?.map((name) => ({ name: normTag(name) })),
    series: info.series ? { name: info.series } : null,
    seriesPosition: info.seriesPosition,
    publishDate: info.publishDate, // already YYYY-MM-DD
    pageCount: info.pageCount,
    blurb: info.blurb,
    cover: info.cover, // a link, the form downloads it when the book is saved
  };
}

/** What to tell the user when no plugin found the book. */
function allFailedMessage(isbn: string, outcome: LookupOutcome): string {
  const { failures } = outcome;
  const names = failures.map((f) => f.plugin).join(", ");
  if (failures.every((f) => f.stage === "not_found")) {
    return `No book found for ISBN ${isbn} (tried ${names})`;
  }
  const reasons = failures.map((f) => `${f.plugin}: ${f.message}`).join("; ");
  return `Couldn't look this book up. Every lookup plugin failed: ${reasons}`;
}

/** What a scan turns into: the draft for the Add Book form, and what to tell the user if the lookup found nothing. */
export type LookupResult = {
  draft: BookDraft;
  /** Set when no plugin found the book. The draft then holds just the ISBN. */
  problem?: string;
};

/**
 * Scanned code -> a draft to prefill the Add Book form with.
 *
 * A valid ISBN always gets a draft: when every plugin fails the draft is just the ISBN and
 * `problem` says why. Only a code that isn't an ISBN rejects, with a `LookupError`.
 */
export async function lookupBook(code: string): Promise<LookupResult> {
  const isbn = normIsbn(code);
  if (!isValidIsbn(isbn)) throw new LookupError(`"${code}" isn't an ISBN, so no book could be looked up`);
  const justTheIsbn: BookDraft = { isbn };

  let outcome: LookupOutcome;
  try {
    outcome = await commands.plugins.lookupBook({ isbn });
  } catch (e) {
    console.warn(String(e));
    return { draft: justTheIsbn, problem: String(e) }; // e.g. no lookup plugins installed
  }

  // Full details for whoever is debugging a plugin. The user only sees the summary below.
  for (const f of outcome.failures) console.warn(f.report);
  for (const w of outcome.warnings) console.warn(`[plugin warning] ${w}`);

  if (!outcome.data) return { draft: justTheIsbn, problem: allFailedMessage(isbn, outcome) };
  return { draft: toDraft(outcome.data, isbn) };
}
