import { useLocation, useNavigate, useOutlet } from "react-router-dom";
import { Alert, Box, Button, IconButton, TextField } from "@mui/material";
import OptionalModal from "@/modal/OptionalModal";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useEffect, useState } from "react";
import { isMobile } from "@/util/misc";
import { withTimeout } from "@/util/async";
import { commands } from "@/lib/commands";
import type { Book, BookInput, Category } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { COVER_SEGMENT, CoverPreviewCard, type CoverCtx } from "./CoverPreview";
import { CategoryField } from "../book-form/CategoryField";
import { ChoicesField, loadAuthors, loadTags } from "../book-form/ChoicesField";
import { CoverField } from "../book-form/CoverField";
import { DateField } from "../book-form/DateField";
import { SeriesField } from "../book-form/SeriesField";
import { toChoice, toChoices } from "../book-form/choice";
import { emptyToNull, isValidIsbn, noSpinners, normIsbn, normTag, normalizeDate, numOrNull } from "../book-form/inputs";
import { defaultTagTypeId, findBookByIsbn, removeCover, saveNew } from "../book-form/persistence";
import type { BookDraft, BookFields, Choice } from "../book-form/types";
import { bumpLibrary } from "../libraryEvents";

/** Router state shape, for `navigate(LibraryPath.AddBook, { state: { initial } satisfies NewBookState })`. */
/** `editBookId` switches the form to editing that book (by id, so its ISBN can change too). */
export type NewBookState = { initial?: BookDraft; editBookId?: number };

/**
 * `initial` prefills the form (all of it optional). It can be passed as a prop or, since this
 * is a route element, through router state: navigate(path, { state: { initial } }).
 * It's only read on first render; later changes to it are ignored.
 */
export default function NewBook({ initial }: { initial?: BookDraft } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as NewBookState | null;
  const seed: BookDraft = initial ?? routeState?.initial ?? {};
  const editId = routeState?.editBookId ?? null; // set = editing that book, not adding
  const editing = editId !== null;
  const [saving, setSaving] = useState(false);

  const [fields, setFields] = useState<BookFields>(() => ({
    title: seed.title ?? "",
    isbn: seed.isbn?.trim() || null,
    blurb: seed.blurb || null,
    pageCount: seed.pageCount ?? null,
    seriesPosition: seed.seriesPosition ?? null,
  }));
  const [authors, setAuthors] = useState<Choice[]>(() => toChoices(seed.authors));
  const [tags, setTags] = useState<Choice[]>(() => toChoices(seed.tags));
  const [categories, setCategories] = useState<Category[]>(() => seed.categories ?? []);
  const [series, setSeries] = useState<Choice | null>(() => (seed.series ? toChoice(seed.series) : null));
  const [cover, setCover] = useState(seed.cover ?? ""); // link or local path
  const [initialCover] = useState(() => (seed.cover ?? "").trim()); // when editing: the cover already on disk
  // what the user typed or picked; a valid prefilled date is normalized, an invalid one is kept
  // as is so the error shows
  const [dateText, setDateText] = useState(() => {
    const raw = seed.publishDate ?? "";
    return normalizeDate(raw) ?? raw;
  });

  // Set while the typed ISBN belongs to another book that's already in the library
  const [existingBook, setExistingBook] = useState<Book | null>(null);
  useEffect(() => {
    const isbn = fields.isbn;
    if (!isbn) {
      setExistingBook(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      findBookByIsbn(isbn)
        .then((b) => !cancelled && setExistingBook(b && b.bookId !== editId ? b : null))
        .catch(() => !cancelled && setExistingBook(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fields.isbn, editId]);

  const patch = (changes: Partial<BookFields>) => setFields((f) => ({ ...f, ...changes }));

  // Mobile only: the nested `cover` route. While it's open the form is hidden, not unmounted,
  // so everything typed so far survives.
  const outlet = useOutlet({ cover, setCover } satisfies CoverCtx);

  const hasCover = cover.trim() !== "";
  // An ISBN is required: it's the book's identity here and the cover's file name.
  const isbnInvalid = fields.isbn === null || !isValidIsbn(fields.isbn);
  const publishDate = normalizeDate(dateText); // undefined = not a valid date
  const dateInvalid = publishDate === undefined;
  const canCreate = fields.title.trim() !== "" && !isbnInvalid && !dateInvalid && !saving && !(editing && existingBook);

  const handleCreate = async () => {
    const isbn = fields.isbn;
    if (!canCreate || !isbn) return;
    setSaving(true);
    let replaced: Book | null = null; // the existing entry this save overrides, if any
    try {
      // Nothing is written until now. State is updated after each step, so if a later
      // step fails and the user retries, what was already saved isn't created again.
      const savedAuthors = await saveNew(
        authors,
        () => commands.db_crud.listAuthors(),
        (a) => a.authorId,
        async (name) =>
          (await commands.db_crud.createAuthor({ author: { name, birthDate: null, deathDate: null } })).authorId
      );
      setAuthors(savedAuthors);

      let tagTypeId: number | null = null; // only looked up / created if a tag really is new
      const savedTags = await saveNew(
        tags,
        () => commands.db_crud.listTags(),
        (t) => t.tagId,
        async (name) => {
          tagTypeId ??= await defaultTagTypeId();
          return (await commands.db_crud.createTag({ tag: { tagTypeId, name } })).tagId;
        },
        normTag
      );
      setTags(savedTags);

      const savedSeries = series
        ? (
          await saveNew(
            [series],
            () => commands.db_crud.listSeries(),
            (x) => x.seriesId,
            async (name) => (await commands.db_crud.createSeries({ name })).seriesId
          )
        )[0]
        : null;
      setSeries(savedSeries);

      const book: BookInput = {
        ...fields,
        title: fields.title.trim(),
        publishDate: publishDate ?? null,
        seriesId: savedSeries?.id ?? null,
        seriesPosition: savedSeries ? fields.seriesPosition : null,
        authorIds: savedAuthors.map((a) => a.id),
        tagIds: savedTags.map((t) => t.id),
        categoryIds: categories.map((c) => c.categoryId),
      };
      const byIsbn = await findBookByIsbn(isbn);
      let target = byIsbn;
      if (editId !== null) {
        // editing: the target is the book being edited, whatever its ISBN is now
        if (byIsbn && byIsbn.bookId !== editId) throw new Error("another book already uses this ISBN");
        target = await commands.db_crud.getBook({ bookId: editId });
      }
      replaced = target;
      if (target) await commands.db_crud.updateBook({ bookId: target.bookId, book });
      else await commands.db_crud.createBook({ book });
    } catch (e) {
      setSaving(false);
      notify(`Couldn't save book: ${String(e)}`, { severity: "error" });
      return;
    }

    try {
      if (editing && hasCover && cover.trim() === initialCover) {
        // Unchanged saved cover: re-saving would copy the file onto itself. It only needs to
        // follow the book if the ISBN changed (the old one is cleaned up below).
        if (replaced?.isbn && normIsbn(replaced.isbn) !== normIsbn(isbn)) {
          await withTimeout(commands.covers.saveCover({ isbn, source: initialCover }), 40_000, "moving the cover");
        }
      } else if (hasCover) {
        const source = cover.trim();
        // Longer than the 30 s download timeout in Rust, so this only fires if the command
        // never answers at all. The source kind (http / content / file / path) is in the
        // message because it tells us which Rust branch is stuck.
        const kind = /^([a-z][a-z0-9+.-]+):/i.exec(source)?.[1] ?? "path";
        console.log(`saveCover: start, source kind=${kind}`);
        await withTimeout(commands.covers.saveCover({ isbn, source }), 40_000, `saving the cover (${kind})`);
        console.log("saveCover: done");
      }

      // Covers are stored by ISBN, so an override can leave a cover with no matching book:
      // the old entry's cover under a differently written ISBN, or the old cover when this
      // save has none.
      if (replaced) {
        const stale = new Set<string>();
        if (replaced.isbn && normIsbn(replaced.isbn) !== normIsbn(isbn)) stale.add(replaced.isbn);
        if (!hasCover) stale.add(isbn);
        for (const s of stale) await removeCover(s);
      }
    } catch (e) {
      notify(`Book saved, but the cover couldn't be updated: ${String(e)}`, { severity: "warning", duration: 12000 });
    }

    // Only now is the book AND its cover on disk. Tell the list to re-query and the affected
    // cards to re-read their cover (before this, a card could mount, find no file yet, and
    // never look again).
    bumpLibrary([isbn, replaced?.isbn]);
    navigate(-1);
  };

  const form = (
    <Box
      sx={{
        p: 2,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        // the dialog paper is overflow: visible (so the preview can sit outside it), scroll here
        maxHeight: isMobile() ? undefined : "calc(100dvh - 64px)",
        overflowY: isMobile() ? undefined : "auto",
      }}
    >
      {isMobile() && (
        <Box>
          <IconButton aria-label="Back" onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
        </Box>
      )}

      <TextField
        label="Title"
        required
        fullWidth
        autoFocus={!seed.title}
        value={fields.title}
        onChange={(e) => patch({ title: e.target.value })}
      />

      <ChoicesField
        label="Authors"
        load={loadAuthors}
        value={authors}
        onChange={setAuthors}
        confirmOnSpace={false} // multi-word names
      />

      <Box sx={{ display: "flex", gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <SeriesField value={series} onChange={setSeries} />
        </Box>
        {series !== null && (
          <TextField
            label="Position"
            type="number"
            sx={{ width: 110, ...noSpinners }}
            value={fields.seriesPosition ?? ""}
            onChange={(e) => patch({ seriesPosition: numOrNull(e.target.value) })}
            slotProps={{ htmlInput: { min: 0, step: "any" } }}
          />
        )}
      </Box>

      <ChoicesField label="Tags" load={loadTags} value={tags} onChange={setTags} removeOnClick normalize={normTag} />

      <CategoryField value={categories} onChange={setCategories} />

      <Box sx={{ display: "flex", gap: 2 }}>
        <TextField
          label="ISBN"
          required
          fullWidth
          value={fields.isbn ?? ""}
          onChange={(e) => patch({ isbn: emptyToNull(e.target.value) })}
          error={fields.isbn !== null && isbnInvalid}
          helperText={fields.isbn !== null && isbnInvalid ? "10 or 13 characters (hyphens are fine)" : undefined}
        />
        <TextField
          label="Pages"
          type="number"
          fullWidth
          sx={noSpinners}
          value={fields.pageCount ?? ""}
          onChange={(e) => patch({ pageCount: numOrNull(e.target.value) })}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
        />
      </Box>

      {existingBook && editing && (
        <Alert severity="error">"{existingBook.title}" already uses this ISBN. Use a different one to save.</Alert>
      )}
      {existingBook && !editing && (
        <Alert severity="warning">
          "{existingBook.title}" already uses this ISBN. Saving will override that entry, and any
          field left blank here will be cleared on it.
        </Alert>
      )}

      <CoverField
        value={cover}
        onChange={setCover}
        helperText="Paste a link or choose a file. It's copied and saved locally"
        // mobile: tap to open the dedicated preview page
        onPreview={isMobile() && hasCover ? () => navigate(COVER_SEGMENT) : undefined}
      />

      <DateField value={dateText} onChange={setDateText} invalid={dateInvalid} />

      <TextField
        label="Blurb"
        fullWidth
        multiline
        minRows={3}
        value={fields.blurb ?? ""}
        onChange={(e) => patch({ blurb: e.target.value === "" ? null : e.target.value })}
      />

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        <Button
          variant="contained"
          color={existingBook ? "warning" : "primary"}
          disabled={!canCreate}
          onClick={handleCreate}
        >
          {saving ? "Saving…" : editing ? "Save" : existingBook ? "Override" : "Create"}
        </Button>
      </Box>
    </Box>
  );

  return (
    <OptionalModal fullWidth maxWidth="sm" slotProps={{ paper: { sx: { overflow: "visible" } } }}>
      <Box sx={{ position: "relative" }}>
        <Box sx={{ display: outlet ? "none" : "block" }}>{form}</Box>
        {outlet}
        {/* desktop: preview sits to the right of this modal */}
        {!isMobile() && hasCover && <CoverPreviewCard source={cover} />}
      </Box>
    </OptionalModal>
  );
}
