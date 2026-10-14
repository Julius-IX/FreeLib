import { useLocation, useNavigate, useOutlet } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  createFilterOptions,
} from "@mui/material";
import OptionalModal from "@components/OptionalModal";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isOnMobile } from "@/App";
import { commands } from "@/lib/commands";
import type { BookInput } from "@/lib/types";
import { TagField } from "@components/TagField";
import { notify } from "@/util/notify";
import { COVER_SEGMENT, CoverPreviewCard, type CoverCtx } from "./CoverPreview";

const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

// Hides the browser's up/down arrows on number inputs.
const noSpinners = {
  "& input[type=number]": { MozAppearance: "textfield" },
  "& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
    { WebkitAppearance: "none", margin: 0 },
};

/**
 * "2024-03-07", "2024/3/7" or "2024.03.07" -> "2024-03-07".
 * Empty -> null. Anything else, or a date that doesn't exist -> undefined (invalid).
 */
function normalizeDate(text: string): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Not every webview can open the native date picker; without it the field is type-only.
const canShowPicker = typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype;

/**
 * An author / tag / series the user picked. `id: null` means it doesn't exist yet:
 * it's only written to the database when the book itself is created.
 */
type Choice = { id: number | null; name: string };
type Saved = { id: number; name: string };

const choiceKey = (c: Choice) => c.id ?? `new:${c.name.toLowerCase()}`;
const toDraft = (text: string): Choice | null => {
  const name = text.trim();
  return name ? { id: null, name } : null;
};

/**
 * Turns every choice into a saved row (in order) and returns the list with real ids.
 * A draft whose name already exists (e.g. prefilled from a scan) reuses that row instead of
 * creating a duplicate, and the same row is never returned twice.
 */
async function saveNew<T extends { name: string }>(
  list: Choice[],
  loadExisting: () => Promise<T[]>,
  idOf: (row: T) => number,
  create: (name: string) => Promise<number>
): Promise<Saved[]> {
  const existing = list.some((c) => c.id === null) ? await loadExisting() : [];
  const out: Saved[] = [];
  for (const c of list) {
    let id = c.id;
    if (id === null) {
      const hit = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
      id = hit ? idOf(hit) : await create(c.name);
    }
    if (!out.some((o) => o.id === id)) out.push({ id, name: c.name });
  }
  return out;
}

/**
 * A prefilled author / tag / series. `{ name }` is matched against what's already in the
 * library when the book is created (reused if found, created if not). Add `id` if there already
 * is an existing row.
 */
export type DraftRef = { id?: number | null; name: string };

export type BookDraft = {
  title?: string;
  isbn?: string | null;
  publishDate?: string | null; // YYYY-MM-DD
  blurb?: string | null;
  pageCount?: number | null;
  authors?: DraftRef[];
  tags?: DraftRef[];
  series?: DraftRef | null;
  seriesPosition?: number | null;
  cover?: string | null; // link or local file path
};

/** Router state shape, for `navigate(LibraryPath.AddBook, { state: { initial } satisfies NewBookState })`. */
export type NewBookState = { initial?: BookDraft };

const toChoice = (r: DraftRef): Choice => ({ id: r.id ?? null, name: r.name.trim() });
const toChoices = (refs: DraftRef[] | undefined): Choice[] => {
  const seen = new Set<string | number>();
  return (refs ?? [])
    .map(toChoice)
    .filter((c) => c.name !== "" && !seen.has(choiceKey(c)) && !!seen.add(choiceKey(c)));
};

// A tag needs a tag type. New tags go under the first existing type, or a "General" one.
async function defaultTagTypeId() {
  const types = await commands.db_crud.listTagTypes();
  return types[0]?.tagTypeId ?? (await commands.db_crud.createTagType({ name: "General" })).tagTypeId;
}

type Fields = Omit<BookInput, "authorIds" | "tagIds" | "seriesId" | "publishDate">;

/**
 * `initial` prefills the form (all of it optional). It can be passed as a prop or, since this
 * is a route element, through router state: navigate(path, { state: { initial } }).
 * It's only read on first render; later changes to it are ignored.
 */
export default function NewBook({ initial }: { initial?: BookDraft } = {}) {
  const navigate = useNavigate();
  const isMobile = useContext(isOnMobile);
  const location = useLocation();
  const seed: BookDraft = initial ?? (location.state as NewBookState | null)?.initial ?? {};
  const [saving, setSaving] = useState(false);

  const [fields, setFields] = useState<Fields>(() => ({
    title: seed.title ?? "",
    isbn: seed.isbn?.trim() || null,
    blurb: seed.blurb || null,
    pageCount: seed.pageCount ?? null,
    seriesPosition: seed.seriesPosition ?? null,
  }));
  const [authors, setAuthors] = useState<Choice[]>(() => toChoices(seed.authors));
  const [tags, setTags] = useState<Choice[]>(() => toChoices(seed.tags));
  const [series, setSeries] = useState<Choice | null>(() => (seed.series ? toChoice(seed.series) : null));
  const [cover, setCover] = useState(seed.cover ?? ""); // link or local path
  // what the user typed or picked; a valid prefilled date is normalized, an invalid one is kept
  // as is so the error shows
  const [dateText, setDateText] = useState(() => {
    const raw = seed.publishDate ?? "";
    return normalizeDate(raw) ?? raw;
  });

  const patch = (changes: Partial<Fields>) => setFields((f) => ({ ...f, ...changes }));

  // Mobile only: the nested `cover` route. While it's open the form is hidden, not unmounted,
  // so everything typed so far survives.
  const outlet = useOutlet({ cover, setCover } satisfies CoverCtx);

  const hasCover = cover.trim() !== "";
  const coverNeedsIsbn = hasCover && !fields.isbn; // covers are stored by ISBN
  const publishDate = normalizeDate(dateText); // undefined = not a valid date
  const dateInvalid = publishDate === undefined;
  const canCreate = fields.title.trim() !== "" && !coverNeedsIsbn && !dateInvalid && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
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
        }
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

      await commands.db_crud.createBook({
        book: {
          ...fields,
          title: fields.title.trim(),
          publishDate: publishDate ?? null,
          seriesId: savedSeries?.id ?? null,
          seriesPosition: savedSeries ? fields.seriesPosition : null,
          authorIds: savedAuthors.map((a) => a.id),
          tagIds: savedTags.map((t) => t.id),
        },
      });
    } catch (e) {
      setSaving(false);
      notify(`Couldn't create book: ${String(e)}`, { severity: "error" });
      return;
    }

    if (hasCover && fields.isbn) {
      try {
        await commands.covers.saveCover({ isbn: fields.isbn, source: cover.trim() });
      } catch (e) {
        notify(`Book created, but the cover couldn't be saved: ${String(e)}`, { severity: "warning" });
      }
    }
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
        maxHeight: isMobile ? undefined : "calc(100dvh - 64px)",
        overflowY: isMobile ? undefined : "auto",
      }}
    >
      {isMobile && (
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

      <ChoicesField label="Tags" load={loadTags} value={tags} onChange={setTags} removeOnClick />

      <Box sx={{ display: "flex", gap: 2 }}>
        <TextField
          label="ISBN"
          fullWidth
          value={fields.isbn ?? ""}
          onChange={(e) => patch({ isbn: emptyToNull(e.target.value) })}
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

      <CoverField
        value={cover}
        onChange={setCover}
        error={coverNeedsIsbn}
        helperText={
          coverNeedsIsbn ? "Covers are copied and saved locally" : "Paste a link or choose a file"
        }
        // mobile: tap to open the dedicated preview page
        onPreview={isMobile && hasCover ? () => navigate(COVER_SEGMENT) : undefined}
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
        <Button variant="contained" disabled={!canCreate} onClick={handleCreate}>
          Create
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
        {!isMobile && hasCover && <CoverPreviewCard source={cover} />}
      </Box>
    </OptionalModal>
  );
}

/** Type a date (YYYY-MM-DD) or, where the webview supports it, pick one from the calendar button. */
function DateField({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  const [touched, setTouched] = useState(invalid); // no error while still typing, but show a bad prefill right away
  const pickerRef = useRef<HTMLInputElement>(null);
  const showError = touched && invalid;

  return (
    <TextField
      label="Publish date"
      placeholder="YYYY-MM-DD"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setTouched(true)}
      error={showError}
      helperText={showError ? "Use the format YYYY-MM-DD" : undefined}
      slotProps={{
        input: {
          endAdornment: canShowPicker ? (
            <InputAdornment position="end" sx={{ position: "relative" }}>
              <IconButton
                aria-label="Pick a date"
                edge="end"
                onClick={() => {
                  try {
                    pickerRef.current?.showPicker();
                  } catch {
                    /* picker unavailable right now, typing still works */
                  }
                }}
              >
                <CalendarMonthIcon />
              </IconButton>
              {/* invisible native input, only here to open the calendar and hand back a date */}
              <input
                ref={pickerRef}
                type="date"
                value={normalizeDate(value) ?? ""}
                onChange={(e) => onChange(e.target.value)}
                tabIndex={-1}
                aria-hidden
                style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              />
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}

function CoverField({
  value,
  onChange,
  error,
  helperText,
  onPreview,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  helperText?: string;
  onPreview?: () => void;
}) {
  const pickFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (typeof picked === "string") onChange(picked);
    } catch (e) {
      notify(`Couldn't open the file picker: ${String(e)}`, { severity: "error" });
    }
  };

  return (
    <TextField
      label="Cover (link or file)"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      helperText={helperText}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              {onPreview && (
                <IconButton aria-label="Preview cover" onClick={onPreview}>
                  <VisibilityIcon />
                </IconButton>
              )}
              <IconButton aria-label="Choose file" onClick={pickFile} edge="end">
                <FolderOpenIcon />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

// Module-level so their identity is stable for ChoicesField's effect.
const loadAuthors = async (): Promise<Choice[]> =>
  (await commands.db_crud.listAuthors()).map((a) => ({ id: a.authorId, name: a.name }));
const loadTags = async (): Promise<Choice[]> =>
  (await commands.db_crud.listTags()).map((t) => ({ id: t.tagId, name: t.name }));

/** Chips field for authors / tags. Typed names become drafts (id: null), nothing is saved here. */
function ChoicesField({
  label,
  load,
  value,
  onChange,
  confirmOnSpace,
  removeOnClick,
}: {
  label: string;
  load: () => Promise<Choice[]>;
  value: Choice[];
  onChange: (next: Choice[]) => void;
  confirmOnSpace?: boolean;
  removeOnClick?: boolean;
}) {
  const [options, setOptions] = useState<Choice[]>([]);
  useEffect(() => {
    load()
      .then(setOptions)
      .catch((e) => notify(`Couldn't load ${label.toLowerCase()}: ${String(e)}`, { severity: "error" }));
  }, [load, label]);

  return (
    <TagField<Choice>
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      getLabel={(c) => c.name}
      getKey={choiceKey}
      parseInput={toDraft}
      confirmOnSpace={confirmOnSpace}
      removeOnClick={removeOnClick}
    />
  );
}

type CreateOption = { inputValue: string };
type SeriesOption = Choice | CreateOption;
const isCreate = (o: SeriesOption): o is CreateOption => "inputValue" in o;
const filter = createFilterOptions<SeriesOption>();

function SeriesField({ value, onChange }: { value: Choice | null; onChange: (c: Choice | null) => void }) {
  const [existing, setExisting] = useState<Choice[]>([]);
  useEffect(() => {
    commands.db_crud
      .listSeries()
      .then((list) => setExisting(list.map((s) => ({ id: s.seriesId, name: s.name }))))
      .catch((e) => notify(`Couldn't load series: ${String(e)}`, { severity: "error" }));
  }, []);

  // a draft isn't in the loaded list; add it so MUI can find the selected value
  const options = useMemo(
    () => (value && value.id === null ? [...existing, value] : existing),
    [existing, value]
  );

  return (
    <Autocomplete<SeriesOption, false, false, false>
      options={options}
      value={value}
      onChange={(_, next) => {
        if (next === null) onChange(null);
        else if (isCreate(next)) onChange({ id: null, name: next.inputValue });
        else onChange(next);
      }}
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params);
        const text = params.inputValue.trim();
        const exists = opts.some((o) => !isCreate(o) && o.name.toLowerCase() === text.toLowerCase());
        if (text && !exists) filtered.push({ inputValue: text });
        return filtered;
      }}
      getOptionLabel={(o) => (isCreate(o) ? o.inputValue : o.name)}
      isOptionEqualToValue={(a, b) => !isCreate(a) && !isCreate(b) && choiceKey(a) === choiceKey(b)}
      renderOption={(props, o) => {
        const { key, ...rest } = props;
        return (
          <li key={key} {...rest}>
            {isCreate(o) ? `Create "${o.inputValue}"` : o.name}
          </li>
        );
      }}
      renderInput={(params) => <TextField {...params} label="Series" />}
    />
  );
}
