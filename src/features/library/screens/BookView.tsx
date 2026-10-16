import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { isMobile } from "@/util/misc";
import { notify } from "@/notifications/notify";
import { bumpLibrary } from "../libraryEvents";
import { LibraryPath } from "../routes";
import { deleteBookAndCover, endReading, startReading, toDraft } from "../book-view/actions";
import { BookMenu } from "../book-view/BookMenu";
import { BookNotFound } from "../book-view/BookNotFound";
import { BookViewBar } from "../book-view/BookViewBar";
import { DeleteBookDialog } from "../book-view/DeleteBookDialog";
import { DesktopLayout } from "../book-view/DesktopLayout";
import { isOpen, sortReadings } from "../book-view/format";
import { MobileLayout } from "../book-view/MobileLayout";
import { useBookCover } from "../book-view/useBookCover";
import { useBookDetails } from "../book-view/useBookDetails";
import type { NewBookState } from "./NewBook";

export default function BookView() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { state, reload } = useBookDetails(bookId);

  const details = state.status === "ready" ? state.details : null;
  const readings = useMemo(() => sortReadings(state.status === "ready" ? state.readings : []), [state]);
  const openReading = readings.find(isOpen) ?? null;
  const cover = useBookCover(details?.book.isbn);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const bar = (
    <BookViewBar onBack={() => navigate(-1)} onMenu={details ? (e) => setMenuAnchor(e.currentTarget) : undefined} />
  );

  if (!details) {
    return (
      <Box sx={{ minHeight: "100%", boxSizing: "border-box" }}>
        {bar}
        {state.status === "missing" ? (
          <BookNotFound message={state.message} />
        ) : (
          <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        )}
      </Box>
    );
  }

  const { book } = details;

  const edit = () => {
    closeMenu();
    // absolute: a relative "add-book" would resolve under view-book/:bookId
    navigate(`/${LibraryPath.AddBook}`, {
      state: { initial: toDraft(details, cover.path), editBookId: book.bookId } satisfies NewBookState,
    });
  };
  const notes = () => {
    navigate("notes");
  }

  // start / end read: do it, then re-read so the history updates
  const runReadAction = async (what: string, action: () => Promise<unknown>) => {
    closeMenu();
    if (busy) return;
    setBusy(true);
    try {
      await action();
      reload();
    } catch (e) {
      notify(`Couldn't ${what}: ${String(e)}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteBookAndCover(book);
    } catch (e) {
      setBusy(false);
      setConfirmingDelete(false);
      notify(`Couldn't delete book: ${String(e)}`, { severity: "error" });
      return;
    }
    bumpLibrary([book.isbn]);
    navigate(-1);
  };

  const Layout = isMobile() ? MobileLayout : DesktopLayout;

  return (
    <Box sx={{ minHeight: "100%", boxSizing: "border-box", pb: 4 }}>
      {bar}
      <Layout details={details} readings={readings} coverUrl={cover.url} />

      <BookMenu
        anchor={menuAnchor}
        onClose={closeMenu}
        reading={!!openReading}
        busy={busy}
        onEdit={edit}
        onNotes={notes}
        onDelete={() => {
          closeMenu();
          setConfirmingDelete(true);
        }}
        onStart={() => {
          if (!openReading) void runReadAction("start reading", () => startReading(book.bookId));
        }}
        onEnd={() => {
          if (openReading) void runReadAction("finish reading", () => endReading(openReading));
        }}
      />
      <DeleteBookDialog
        open={confirmingDelete}
        title={book.title}
        readingCount={readings.length}
        busy={busy}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
      />
    </Box>
  );
}
