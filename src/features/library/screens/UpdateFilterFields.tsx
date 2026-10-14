import { useNavigate } from "react-router-dom";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useCallback, useEffect, useMemo, useState } from "react";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { defaultTagTypeId } from "../book-form/persistence";
import { DateField } from "../book-form/DateField";
import { normalizePartialDate, startsAfter } from "../book-form/inputs";

type Kind = "tags" | "series" | "authors";
type Entry = { id: number; name: string; birth?: string | null; death?: string | null };

const LABEL: Record<Kind, string> = { tags: "tag", series: "series", authors: "author" };

async function loadEntries(kind: Kind): Promise<Entry[]> {
  let rows: Entry[];
  if (kind === "tags") {
    rows = (await commands.db_crud.listTags()).map((t) => ({ id: t.tagId, name: t.name }));
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
  const isAuthors = kind === "authors";

  const resetForm = useCallback(() => {
    setName("");
    setBirth("");
    setDeath("");
    setEditing(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setEntries(await loadEntries(kind));
    } catch {
      notify(`Couldn't load ${LABEL[kind]}s`, { severity: "error" });
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

  const canSubmit = !!trimmed && !taken && !busy && !birthBad && !deathBad && !orderBad;

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
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (kind === "tags") {
        await commands.db_crud.createTag({ tag: { tagTypeId: await defaultTagTypeId(), name: trimmed } });
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
      else if (kind === "series") await commands.db_crud.deleteSeries({ seriesId: target.id });
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
              endAdornment: isAuthors ? undefined : (
                <Button disabled={!canSubmit} onClick={handleSubmit}>
                  Add
                </Button>
              ),
            },
          }}
        />

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
          {visible.map((e) => (
            <Chip
              key={e.id}
              label={isAuthors ? `${e.name}${lifespan(e)}` : e.name}
              disabled={busy}
              color={editing?.id === e.id ? "primary" : "default"}
              onClick={isAuthors ? () => startEdit(e) : undefined}
              onDelete={() => setPendingDelete(e)}
            />
          ))}
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
