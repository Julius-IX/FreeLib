import { commands } from "@/lib/commands";
import { deleteBookAndCover } from "../book-view/actions";
import { defaultTagTypeId, saveNew } from "../book-form/persistence";
import { normTag } from "../book-form/inputs";
import type { Choice } from "../book-form/types";

/**
 * Actions on many books at once. Every action is a worker for one book that says whether it
 * changed anything, and `runBulk` loops over the books with progress and a stop.
 *
 * The loop is sequential on purpose. Each step is a few quick database calls, so there is little to
 * gain from running them in parallel, and a stop between two books leaves nothing half done.
 */

export type BulkProgress = { total: number; done: number };

export type BulkSummary = {
  total: number;
  changed: number;
  /** The book already was the way the action wanted it. */
  unchanged: number;
  failed: number;
  stopped: boolean;
  /** A few distinct error messages, for the report. */
  problems: string[];
};

export type BulkOptions = {
  onProgress?: (p: BulkProgress) => void;
  /** Polled between two books. */
  shouldStop?: () => boolean;
};

const MAX_PROBLEMS = 5;

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** Resolves to true when the book was changed. */
type Worker = (bookId: number) => Promise<boolean>;

export async function runBulk(bookIds: number[], work: Worker, opts: BulkOptions = {}): Promise<BulkSummary> {
  const { onProgress, shouldStop = () => false } = opts;
  const summary: BulkSummary = {
    total: bookIds.length,
    changed: 0,
    unchanged: 0,
    failed: 0,
    stopped: false,
    problems: [],
  };
  let done = 0;
  onProgress?.({ total: bookIds.length, done });

  for (const bookId of bookIds) {
    if (shouldStop()) {
      summary.stopped = true;
      break;
    }
    try {
      if (await work(bookId)) summary.changed++;
      else summary.unchanged++;
    } catch (e) {
      summary.failed++;
      const text = message(e);
      if (summary.problems.length < MAX_PROBLEMS && !summary.problems.includes(text)) summary.problems.push(text);
    }
    onProgress?.({ total: bookIds.length, done: ++done });
  }
  return summary;
}

// SECTION: list changes

/** How a book's list of tags, categories or shelves is edited. */
export type ListMode = "add" | "remove" | "set";
export type ListChange = { mode: ListMode; ids: number[] };

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The list after the change, or null when it would stay the same. */
export function applyListChange(current: number[], { mode, ids }: ListChange): number[] | null {
  const wanted = [...new Set(ids)];
  if (mode === "set") return sameIds(current, wanted) ? null : wanted;
  if (mode === "remove") {
    const next = current.filter((id) => !wanted.includes(id));
    return next.length === current.length ? null : next;
  }
  const next = [...current, ...wanted.filter((id) => !current.includes(id))];
  return next.length === current.length ? null : next;
}

// SECTION: workers

export type LinkChanges = { tags?: ListChange; categories?: ListChange };

/**
 * Edits the tags and/or categories of a book. `update_book` replaces every link of the book, so
 * the authors and whatever this change doesn't touch are read first and passed back unchanged.
 */
export const editLinks =
  (changes: LinkChanges): Worker =>
  async (bookId) => {
    const [book, authors, tags, categories] = await Promise.all([
      commands.db_crud.getBook({ bookId }),
      commands.db_crud.getBookAuthors({ bookId }),
      commands.db_crud.getBookTags({ bookId }),
      commands.db.getAllCategories({ bookId }),
    ]);
    const tagIds = tags.map((t) => t.tagId);
    const categoryIds = categories.map((c) => c.categoryId);
    const nextTags = changes.tags ? applyListChange(tagIds, changes.tags) : null;
    const nextCategories = changes.categories ? applyListChange(categoryIds, changes.categories) : null;
    if (!nextTags && !nextCategories) return false;

    await commands.db_crud.updateBook({
      bookId,
      book: {
        title: book.title,
        isbn: book.isbn,
        publishDate: book.publishDate,
        blurb: book.blurb,
        pageCount: book.pageCount,
        seriesId: book.seriesId,
        seriesPosition: book.seriesPosition,
        authorIds: authors.map((a) => a.authorId),
        tagIds: nextTags ?? tagIds,
        categoryIds: nextCategories ?? categoryIds,
      },
    });
    return true;
  };

export const editShelves =
  (change: ListChange): Worker =>
  async (bookId) => {
    const shelves = await commands.db_crud.getBookShelves({ bookId });
    const next = applyListChange(
      shelves.map((s) => s.shelfId),
      change,
    );
    if (!next) return false;
    await commands.db_crud.setBookShelves({ bookId, shelfIds: next });
    return true;
  };

export const deleteBook: Worker = async (bookId) => {
  await deleteBookAndCover(await commands.db_crud.getBook({ bookId }));
  return true;
};

/**
 * Turns the tags picked in the dialog into ids. Typed names (`id: null`) are matched against the
 * existing tags and created when new, so the per-book workers only ever deal with ids and the same
 * new tag is never created twice.
 */
export async function resolveTagIds(choices: Choice[]): Promise<number[]> {
  let tagTypeId: number | null = null;
  const saved = await saveNew(
    choices,
    () => commands.db_crud.listTags(),
    (t) => t.tagId,
    async (name) => {
      tagTypeId ??= await defaultTagTypeId();
      return (await commands.db_crud.createTag({ tag: { tagTypeId, name } })).tagId;
    },
    normTag,
  );
  return saved.map((s) => s.id);
}
