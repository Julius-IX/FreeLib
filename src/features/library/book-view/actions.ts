import { commands } from "@/lib/commands";
import type { Book, Reading } from "@/lib/types";
import { isValidIsbn } from "../book-form/inputs";
import { removeCover } from "../book-form/persistence";
import type { BookDraft } from "../book-form/types";
import { today } from "./format";
import type { BookDetails } from "./types";

/** What the edit form is prefilled with. `cover` is the saved cover's local path, if any. */
export function toDraft({ book, authors, tags, series }: BookDetails, cover: string | null): BookDraft {
  return {
    title: book.title,
    isbn: book.isbn,
    publishDate: book.publishDate,
    blurb: book.blurb,
    pageCount: book.pageCount,
    authors: authors.map((a) => ({ id: a.authorId, name: a.name })),
    tags: tags.map((t) => ({ id: t.tagId, name: t.name })),
    series: series ? { id: series.seriesId, name: series.name } : null,
    seriesPosition: book.seriesPosition,
    cover,
  };
}

export const startReading = (bookId: number) =>
  commands.db_crud.createReading({ reading: { bookId, dateStarted: today(), dateFinished: null } });

export const endReading = (r: Reading) =>
  commands.db_crud.updateReading({
    readingId: r.readingId,
    reading: { bookId: r.bookId, dateStarted: r.dateStarted, dateFinished: today() },
  });

/** Deletes the book, then its cover (covers are stored by ISBN, so it would otherwise be left behind). */
export async function deleteBookAndCover(book: Book) {
  await commands.db_crud.deleteBook({ bookId: book.bookId });
  if (book.isbn && isValidIsbn(book.isbn)) {
    try {
      await removeCover(book.isbn);
    } catch (e) {
      console.error("deleteBookAndCover: couldn't remove the cover", e);
    }
  }
}
