import { useNavigate } from "react-router-dom";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Tab, Tabs, TextField,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useCallback, useEffect, useMemo, useState } from "react";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { defaultTagTypeId } from "../book-form/persistence";

type Kind = "tags" | "series";
type Entry = { id: number; name: string };

const LABEL: Record<Kind, string> = { tags: "tag", series: "series" };

async function loadEntries(kind: Kind): Promise<Entry[]> {
  const rows =
    kind === "tags"
      ? (await commands.db_crud.listTags()).map((t) => ({ id: t.tagId, name: t.name }))
      : (await commands.db_crud.listSeries()).map((s) => ({ id: s.seriesId, name: s.name }));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export default function UpdateFilterFields() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("tags");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await loadEntries(kind));
    } catch {
      notify(`Couldn't load ${LABEL[kind]}s`, { severity: "error" });
    }
  }, [kind]);

  useEffect(() => {
    setEntries([]);
    setName("");
    refresh();
  }, [refresh]);

  const trimmed = name.trim();
  const taken = useMemo(
    () => entries.some((e) => e.name.toLowerCase() === trimmed.toLowerCase()),
    [entries, trimmed],
  );
  const canAdd = !!trimmed && !taken && !busy;
  // Typing in the field also narrows the list, so you can find an existing entry before adding a dupe.
  const visible = useMemo(
    () => (trimmed ? entries.filter((e) => e.name.toLowerCase().includes(trimmed.toLowerCase())) : entries),
    [entries, trimmed],
  );

  const handleAdd = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      if (kind === "tags") {
        await commands.db_crud.createTag({ tag: { tagTypeId: await defaultTagTypeId(), name: trimmed } });
      } else {
        await commands.db_crud.createSeries({ name: trimmed });
      }
      setName("");
      await refresh();
    } catch {
      notify(`Couldn't add ${LABEL[kind]}`, { severity: "error" });
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
      else await commands.db_crud.deleteSeries({ seriesId: target.id });
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
        </Tabs>

        <TextField
          label={`Add ${LABEL[kind]}`}
          fullWidth
          autoFocus={!isMobile()}
          sx={{ flexShrink: 0 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          error={taken}
          helperText={taken ? `A ${LABEL[kind]} with this name already exists` : " "}
          slotProps={{
            input: {
              endAdornment: (
                <Button disabled={!canAdd} onClick={handleAdd}>
                  Add
                </Button>
              ),
            },
          }}
        />

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
            <Chip key={e.id} label={e.name} disabled={busy} onDelete={() => setPendingDelete(e)} />
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
