import { useCallback } from "react";
import { useParams } from "react-router-dom";
import NotesPage from "@/components/NotesPage";
import { commands } from "@/lib/commands";
import { useBookDetails } from "../book-view/useBookDetails";

/** Notes for one book. The screen itself (page on mobile, modal on desktop) is `NotesPage`. */
export default function BookNotes() {
  const { bookId } = useParams<{ bookId: string }>();
  const { state } = useBookDetails(bookId);
  const title = state.status === "ready" ? state.details.book.title : "";
  const id = bookId !== undefined && /^\d+$/.test(bookId) ? Number(bookId) : null;

  const load = useCallback(() => commands.db_crud.getBookNotes({ bookId: id! }), [id]);
  const save = useCallback((notes: string) => commands.db_crud.updateBookNotes({ bookId: id!, notes }), [id]);

  return (
    <NotesPage
      title="Notes"
      subtitle={title}
      what="notes"
      loadFailedText="Couldn't load this book's notes."
      load={id === null ? null : load}
      save={save}
    />
  );
}
