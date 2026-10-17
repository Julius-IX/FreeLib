import { useNavigate } from "react-router-dom";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { defaultTagTypeId } from "../book-form/persistence";
import { DateField } from "../book-form/DateField";
import { normTag, normalizePartialDate, startsAfter } from "../book-form/inputs";
import { CategoryChip } from "@/components/CategoryChip";
import { selectedChipSx } from "@/components/chipHighlight";
import { useCategoryStyle } from "../categoryStyle";
import { bumpLibrary } from "../libraryEvents";

type Kind = "tags" | "categories" | "series" | "authors";
type Entry = { id: number; name: string; birth?: string | null; death?: string | null; color?: string };

const LABEL: Record<Kind, string> = { tags: "tag", categories: "category", series: "series", authors: "author" };
const LABEL_PLURAL: Record<Kind, string> = { tags: "tags", categories: "categories", series: "series", authors: "authors" };

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLOR = "#3b82f6";
/** Quick picks under the wheel. */
const PRESETS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
  "#6366f1", "#a855f7", "#ec4899", "#78716c", "#64748b", "#111827",
];

async function loadEntries(kind: Kind): Promise<Entry[]> {
  let rows: Entry[];
  if (kind === "tags") {
    rows = (await commands.db_crud.listTags()).map((t) => ({ id: t.tagId, name: t.name }));
  } else if (kind === "categories") {
    rows = (await commands.db_crud.listCategories()).map((c) => ({ id: c.categoryId, name: c.name, color: c.color }));
  } else if (kind === "series") {
    rows = (await commands.db_crud.listSeries()).map((s) => ({ id: s.seriesId, name: s.name }));
  } else {
    rows = (await commands.db_crud.listAuthors()).map((a) => ({
      id: a.authorId,
      name: a.name,
      birth: a.birthDate,
      death: a.deathDate,
    }));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const year = (d?: string | null) => (d ? d.slice(0, 4) : "");
/** " (1892–1973)", " (1892–)" or "" when the author has no dates. */
const lifespan = (e: Entry) => (e.birth || e.death ? ` (${year(e.birth)}–${year(e.death)})` : "");

export default function UpdateFilterFields() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("tags");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  // Authors only: the row being edited (null = adding a new one) and its date fields.
  const [editing, setEditing] = useState<Entry | null>(null);
  const [birth, setBirth] = useState("");
  const [death, setDeath] = useState("");
  // Categories only: `#rrggbb` as typed (may be half-typed), shown live in the preview chip.
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [categoryStyle] = useCategoryStyle();
  const isAuthors = kind === "authors";
  const isCategories = kind === "categories";
  const colorBad = isCategories && !HEX.test(color);

  const resetForm = useCallback(() => {
    setName("");
    setBirth("");
    setDeath("");
    setColor(DEFAULT_COLOR);
    setEditing(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setEntries(await loadEntries(kind));
    } catch {
      notify(`Couldn't load ${LABEL_PLURAL[kind]}`, { severity: "error" });
    }
  }, [kind]);

  useEffect(() => {
    setEntries([]);
    resetForm();
    refresh();
  }, [refresh, resetForm]);

  const trimmed = name.trim();
  const taken = useMemo(
    () => entries.some((e) => e.id !== editing?.id && e.name.toLowerCase() === trimmed.toLowerCase()),
    [entries, trimmed, editing],
  );

  // undefined = not a valid date, null = empty.
  const birthN = normalizePartialDate(birth);
  const deathN = normalizePartialDate(death);
  const birthBad = isAuthors && birthN === undefined;
  const deathBad = isAuthors && deathN === undefined;
  const orderBad = !!birthN && !!deathN && startsAfter(birthN, deathN);

  const canSubmit = !!trimmed && !taken && !busy && !birthBad && !deathBad && !orderBad && !colorBad;

  // Typing in the field also narrows the list, so you can find an existing entry before adding a dupe.
  // While editing an author the list stays whole.
  const visible = useMemo(
    () =>
      trimmed && !editing ? entries.filter((e) => e.name.toLowerCase().includes(trimmed.toLowerCase())) : entries,
    [entries, trimmed, editing],
  );

  const startEdit = (e: Entry) => {
    setEditing(e);
    setName(e.name);
    setBirth(e.birth ?? "");
    setDeath(e.death ?? "");
    setColor(e.color ?? DEFAULT_COLOR);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (kind === "tags") {
        await commands.db_crud.createTag({ tag: { tagTypeId: await defaultTagTypeId(), name: normTag(trimmed) } });
      } else if (kind === "categories") {
        // the table only accepts lower-case-or-not `#rrggbb`; stored lower-case so colour search matches
        const category = { name: trimmed, color: color.toLowerCase() };
        if (editing) await commands.db_crud.updateCategory({ categoryId: editing.id, category });
        else await commands.db_crud.createCategory({ category });
        bumpLibrary([]); // cards and open book views re-read their category colours
      } else if (kind === "series") {
        await commands.db_crud.createSeries({ name: trimmed });
      } else {
        const author = { name: trimmed, birthDate: birthN ?? null, deathDate: deathN ?? null };
        if (editing) await commands.db_crud.updateAuthor({ authorId: editing.id, author });
        else await commands.db_crud.createAuthor({ author });
      }
      resetForm();
      await refresh();
    } catch {
      notify(`Couldn't ${editing ? "save" : "add"} ${LABEL[kind]}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    setBusy(true);
    try {
      if (kind === "tags") await commands.db_crud.deleteTag({ tagId: target.id });
      else if (kind === "categories") {
        await commands.db_crud.deleteCategory({ categoryId: target.id });
        bumpLibrary([]);
      } else if (kind === "series") {
        await commands.db_crud.deleteSeries({ seriesId: target.id });
        bumpLibrary([]); // books that were in it lose the series (and position) on screen too
      }
      else await commands.db_crud.deleteAuthor({ authorId: target.id });
      if (editing?.id === target.id) resetForm();
      await refresh();
    } catch {
      notify(`Couldn't remove ${LABEL[kind]}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <OptionalModal fullWidth maxWidth="sm">
      {/* Mobile: full page, fills the screen. Desktop: fixed-height dialog body. Either way the
          chip list below is the only part that scrolls. */}
      <Box
        sx={{
          p: 2,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          height: isMobile() ? "100%" : "70vh",
          minHeight: 0,
        }}
      >
        {isMobile() && (
          <Box sx={{ flexShrink: 0 }}>
            <IconButton aria-label="Back" onClick={() => navigate(-1)}>
              <ArrowBackIcon />
            </IconButton>
          </Box>
        )}

        <Tabs value={kind} onChange={(_, v: Kind) => setKind(v)} variant="fullWidth" sx={{ flexShrink: 0 }}>
          <Tab value="tags" label="Tags" />
          <Tab value="categories" label="Categories" />
          <Tab value="series" label="Series" />
          <Tab value="authors" label="Authors" />
        </Tabs>

        <TextField
          label={editing ? `Edit ${LABEL[kind]}` : `Add ${LABEL[kind]}`}
          fullWidth
          autoFocus={!isMobile()}
          sx={{ flexShrink: 0 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          error={taken}
          helperText={taken ? `A ${LABEL[kind]} with this name already exists` : " "}
          slotProps={{
            input: {
              endAdornment: isAuthors || isCategories ? undefined : (
                <Button disabled={!canSubmit} onClick={handleSubmit}>
                  Add
                </Button>
              ),
            },
          }}
        />

        {isCategories && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, flexShrink: 0 }}>
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              {/* The native colour input is the wheel / picker of the platform. */}
              <Box
                component="input"
                type="color"
                aria-label="Pick a color"
                value={colorBad ? DEFAULT_COLOR : color.toLowerCase()}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
                sx={{
                  width: 56, height: 56, p: 0, flexShrink: 0, cursor: "pointer",
                  border: 1, borderColor: "divider", borderRadius: "50%", bgcolor: "transparent",
                  "&::-webkit-color-swatch-wrapper": { p: 0 },
                  "&::-webkit-color-swatch": { border: "none", borderRadius: "50%" },
                  "&::-moz-color-swatch": { border: "none", borderRadius: "50%" },
                }}
              />
              <TextField
                label="Color"
                size="small"
                value={color}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setColor(v && !v.startsWith("#") ? `#${v}` : v);
                }}
                error={colorBad}
                helperText={colorBad ? "Use #rrggbb" : " "}
                sx={{ width: 130 }}
                slotProps={{ htmlInput: { maxLength: 7, spellCheck: false } }}
              />
              <Box sx={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
                <CategoryChip
                  category={{ name: trimmed || "Preview", color: colorBad ? DEFAULT_COLOR : color.toLowerCase() }}
                  variant={categoryStyle}
                  base="filled"
                  size="medium"
                />
              </Box>
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {PRESETS.map((c) => (
                <Box
                  key={c}
                  component="button"
                  type="button"
                  aria-label={`Use ${c}`}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 28, height: 28, p: 0, borderRadius: "50%", cursor: "pointer", bgcolor: c,
                    border: 2, borderColor: color.toLowerCase() === c ? "text.primary" : "transparent",
                  }}
                />
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              {editing && (
                <Button disabled={busy} onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
                {editing ? "Save" : "Add"}
              </Button>
            </Box>
          </Box>
        )}

        {isAuthors && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
            <Box sx={{ display: "flex", gap: 2 }}>
              {/* key: a different author starts with a clean "touched" state */}
              <Box sx={{ flex: 1 }}>
                <DateField
                  key={`b-${editing?.id ?? "new"}`}
                  label="Born"
                  partial
                  value={birth}
                  onChange={setBirth}
                  invalid={birthBad}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <DateField
                  key={`d-${editing?.id ?? "new"}`}
                  label="Died"
                  partial
                  value={death}
                  onChange={setDeath}
                  invalid={deathBad}
                />
              </Box>
            </Box>
            {orderBad && (
              <Typography color="error" variant="body2">
                Death date is before the birth date
              </Typography>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              {editing && (
                <Button disabled={busy} onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
                {editing ? "Save" : "Add"}
              </Button>
            </Box>
          </Box>
        )}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexWrap: "wrap",
            alignContent: "flex-start",
            gap: 1,
          }}
        >
          {visible.map((e) =>
            isCategories ? (
              <CategoryChip
                key={e.id}
                category={{ name: e.name, color: e.color ?? DEFAULT_COLOR }}
                variant={categoryStyle}
                base="filled"
                size="medium"
                disabled={busy}
                sx={editing?.id === e.id ? selectedChipSx : undefined}
                onClick={() => startEdit(e)}
                onDelete={() => setPendingDelete(e)}
              />
            ) : (
              <Chip
                key={e.id}
                label={isAuthors ? `${e.name}${lifespan(e)}` : e.name}
                disabled={busy}
                sx={editing?.id === e.id ? selectedChipSx : undefined}
                onClick={isAuthors ? () => startEdit(e) : undefined}
                onDelete={() => setPendingDelete(e)}
              />
            ),
          )}
        </Box>
      </Box>

      <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Remove {LABEL[kind]}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            "{pendingDelete?.name}" will be removed from your local database, including from every book that uses it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" onClick={handleDelete}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </OptionalModal>
  );
}
