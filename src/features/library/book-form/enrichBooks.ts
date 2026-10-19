import { commands } from "@/lib/commands";
import type { Book } from "@/lib/types";
import { withTimeout } from "@/util/async";
import { toDraft } from "../book-scan/lookup";
import { defaultTagTypeId, saveNew } from "./persistence";
import { isValidIsbn, normIsbn, normTag } from "./inputs";
import { type FormSnapshot, mergeLookup } from "./mergeLookup";
import type { Choice } from "./types";

/**
 * Runs the lookup plugins on books that are already saved and fills in what they're missing, with the same rule as the form's "Look up details"
 * button: only empty fields are filled, nothing that is there gets replaced (`mergeLookup`).
 *
 * It's a loop over single books on purpose, so the caller gets a progress callback after every
 * book and can stop between two of them. What was already done stays done.
 *
 * Lookups run a few at a time (they wait on the network). Writes never overlap: two books that
 * both bring a new tag or author would otherwise each create it.
 */

export type EnrichProgress = {
  total: number;
  done: number;
  /** Books that got something new. */
  updated: number;
  /** Found, but nothing in it that the book didn't already have. */
  unchanged: number;
  /** No plugin knew the ISBN. */
  notFound: number;
  /** No (valid) ISBN to ask about. */
  noIsbn: number;
  /** The lookup or the save went wrong (network, plugin error...). */
  failed: number;
  /** Covers that were downloaded and saved. */
  covers: number;
};

export type EnrichResult = EnrichProgress & {
  /** Books whose cover changed, for `bumpLibrary`. */
  coverIds: number[];
  /** Why it ended early: the user stopped it, or every lookup kept failing. `null` = ran to the end. */
  stopped: "user" | "failing" | null;
  /** A few distinct reasons for `failed`, for the report. */
  problems: string[];
};

export type EnrichOptions = {
  onProgress?: (p: EnrichProgress) => void;
  /** Polled between books. */
  shouldStop?: () => boolean;
  /** How many lookups wait on the network at once. */
  concurrency?: number;
};

/** In a row, with no book answered in between: the network (or every plugin) is down, so give up. */
const GIVE_UP_AFTER = 8;
const LOOKUP_TIMEOUT_MS = 60_000;
const COVER_TIMEOUT_MS = 40_000; // longer than the 30 s download timeout in Rust, as in the form
const MAX_PROBLEMS = 5;

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** Rejects up front when there is nothing to ask, instead of failing once per book. */
async function assertPluginsAvailable() {
  const plugins = await commands.plugins.listPlugins();
  if (plugins.length === 0) throw new Error("No lookup plugins are installed");
  if (!plugins.some((p) => p.enabled)) throw new Error("Every lookup plugin is turned off");
}

export async function enrichBooks(bookIds: number[], opts: EnrichOptions = {}): Promise<EnrichResult> {
  const { onProgress, shouldStop = () => false, concurrency = 3 } = opts;
  await assertPluginsAvailable();

  const result: EnrichResult = {
    total: bookIds.length,
    done: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    noIsbn: 0,
    failed: 0,
    covers: 0,
    coverIds: [],
    stopped: null,
    problems: [],
  };
  const report = () => {
    const { coverIds: _c, stopped: _s, problems: _p, ...progress } = result;
    onProgress?.(progress);
  };
  const addProblem = (text: string) => {
    if (result.problems.length < MAX_PROBLEMS && !result.problems.includes(text)) result.problems.push(text);
  };

  let next = 0;
  let failuresInARow = 0;
  let writes: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = writes.then(fn);
    writes = run.catch(() => undefined);
    return run;
  };

  const enrichOne = async (bookId: number) => {
    const book = await commands.db_crud.getBook({ bookId });
    if (!book.isbn || !isValidIsbn(book.isbn)) {
      result.noIsbn++;
      return;
    }
    const isbn = normIsbn(book.isbn);

    const outcome = await withTimeout(commands.plugins.lookupBook({ isbn }), LOOKUP_TIMEOUT_MS, "the lookup");
    if (!outcome.data) {
      // Not knowing a book is normal. Anything else (network, a broken plugin) is a failure.
      if (outcome.failures.every((f) => f.stage === "not_found")) {
        result.notFound++;
        failuresInARow = 0;
      } else {
        result.failed++;
        failuresInARow++;
        addProblem(outcome.failures.map((f) => `${f.plugin}: ${f.message}`).join("; "));
      }
      return;
    }
    failuresInARow = 0;

    const merged = await oneAtATime(() => applyLookup(book, toDraft(outcome.data!, isbn)));
    if (merged.filled.length === 0) {
      result.unchanged++;
      return;
    }
    result.updated++;

    // The cover is a download, so it happens outside the write queue.
    if (merged.cover) {
      try {
        await withTimeout(
          commands.covers.saveCover({ bookId, source: merged.cover }),
          COVER_TIMEOUT_MS,
          "saving the cover"
        );
        result.covers++;
        result.coverIds.push(bookId);
      } catch (e) {
        addProblem(`cover for “${book.title}”: ${message(e)}`);
      }
    }
  };

  const worker = async () => {
    while (next < bookIds.length) {
      if (shouldStop()) {
        result.stopped ??= "user";
        return;
      }
      if (failuresInARow >= GIVE_UP_AFTER) {
        result.stopped ??= "failing";
        return;
      }
      const bookId = bookIds[next++];
      try {
        await enrichOne(bookId);
      } catch (e) {
        result.failed++;
        failuresInARow++;
        addProblem(message(e));
      }
      result.done++;
      report();
    }
  };

  report();
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, bookIds.length)) }, worker));
  return result;
}

/**
 * Merges the lookup into the saved book and writes it. Returns what was filled; `cover` is the
 * link to download, if the book had no cover and the lookup has one. Must not run twice at once.
 */
async function applyLookup(book: Book, draft: ReturnType<typeof toDraft>) {
  const bookId = book.bookId;
  const [authorRows, tagRows, categoryRows, seriesRow, coverPath] = await Promise.all([
    commands.db_crud.getBookAuthors({ bookId }),
    commands.db_crud.getBookTags({ bookId }),
    commands.db.getAllCategories({ bookId }),
    book.seriesId === null ? Promise.resolve(null) : commands.db_crud.getSeries({ seriesId: book.seriesId }),
    commands.covers.getCoverPath({ bookId }),
  ]);

  const current: FormSnapshot = {
    fields: {
      title: book.title,
      isbn: book.isbn,
      blurb: book.blurb,
      pageCount: book.pageCount,
      seriesPosition: book.seriesPosition,
    },
    authors: authorRows.map((a): Choice => ({ id: a.authorId, name: a.name })),
    tags: tagRows.map((t): Choice => ({ id: t.tagId, name: t.name })),
    series: seriesRow ? { id: seriesRow.seriesId, name: seriesRow.name } : null,
    cover: coverPath ?? "", // only whether there is one matters
    dateText: book.publishDate ?? "",
  };
  const merged = mergeLookup(current, draft);

  // Only the cover? It has no database row to update.
  if (merged.filled.some((f) => f !== "cover")) {
    // Choices that already have an id pass through unchanged; new names are matched or created.
    const authors = await saveNew(
      merged.authors ?? current.authors,
      () => commands.db_crud.listAuthors(),
      (a) => a.authorId,
      async (name) =>
        (await commands.db_crud.createAuthor({ author: { name, birthDate: null, deathDate: null } })).authorId
    );
    let tagTypeId: number | null = null;
    const tags = await saveNew(
      merged.tags ?? current.tags,
      () => commands.db_crud.listTags(),
      (t) => t.tagId,
      async (name) => {
        tagTypeId ??= await defaultTagTypeId();
        return (await commands.db_crud.createTag({ tag: { tagTypeId, name } })).tagId;
      },
      normTag
    );
    const series = (merged.series ?? current.series)
      ? (
          await saveNew(
            [(merged.series ?? current.series)!],
            () => commands.db_crud.listSeries(),
            (s) => s.seriesId,
            async (name) => (await commands.db_crud.createSeries({ name })).seriesId
          )
        )[0]
      : null;

    await commands.db_crud.updateBook({
      bookId,
      book: {
        title: merged.fields.title ?? book.title,
        isbn: book.isbn,
        publishDate: merged.dateText ?? book.publishDate,
        blurb: merged.fields.blurb ?? book.blurb,
        pageCount: merged.fields.pageCount ?? book.pageCount,
        seriesId: series?.id ?? null,
        seriesPosition: series ? (merged.fields.seriesPosition ?? book.seriesPosition) : null,
        authorIds: authors.map((a) => a.id),
        tagIds: tags.map((t) => t.id),
        // update_book replaces the links, so the book's own categories are passed back unchanged
        categoryIds: categoryRows.map((c) => c.categoryId),
      },
    });
  }
  return { filled: merged.filled, cover: merged.cover };
}
