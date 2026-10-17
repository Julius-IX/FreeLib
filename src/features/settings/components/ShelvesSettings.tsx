import { useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { commands } from "@/lib/commands";
import type { Shelf } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { bumpLibrary } from "@/features/library/libraryEvents";
import { useShelves } from "@/features/library/shelves/useShelves";
import { Preference, Section } from "./Preferences";

/** `"new"` = the add dialog, a shelf = renaming it, `null` = closed. */
type NameTarget = Shelf | "new" | null;

/**
 * Where shelves are made. Each shelf becomes a tab in the library; books are put on shelves
 * from their own page. With no shelves the library has no tabs at all.
 */
export function ShelvesSettings() {
  const { shelves } = useShelves();
  const [naming, setNaming] = useState<NameTarget>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Shelf | null>(null);
  const [busy, setBusy] = useState(false);

  const renaming = naming !== null && naming !== "new" ? naming : null;
  const trimmed = name.trim();
  const taken = shelves.some((s) => s.shelfId !== renaming?.shelfId && s.name.toLowerCase() === trimmed.toLowerCase());
  const canSubmit = !!trimmed && !taken && !busy;

  /** Runs a change, then tells the library (tabs) and book pages (shelf button) to re-read. */
  const run = async (what: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      bumpLibrary([]);
      return true;
    } catch (e) {
      notify(`Couldn't ${what}: ${String(e)}`, { severity: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openNaming = (target: Exclude<NameTarget, null>) => {
    setName(target === "new" ? "" : target.name);
    setNaming(target);
  };

  const submit = async () => {
    if (!canSubmit || naming === null) return;
    const ok = await run(renaming ? "rename the shelf" : "add the shelf", () =>
      renaming
        ? commands.db_crud.updateShelf({ shelfId: renaming.shelfId, name: trimmed })
        : commands.db_crud.createShelf({ name: trimmed }),
    );
    if (ok) setNaming(null);
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = shelves.map((s) => s.shelfId);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    void run("move the shelf", () => commands.db_crud.reorderShelves({ shelfIds: ids }));
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await run("delete the shelf", () => commands.db_crud.deleteShelf({ shelfId: pendingDelete.shelfId }));
    if (ok) setPendingDelete(null);
  };

  return (
    <Section title="Shelves">
      {shelves.length === 0 && (
        <Preference
          title="No shelves yet"
          summary="The library is one list for now. Add a shelf to start organizing your books."
        />
      )}

      {shelves.map((s, i) => (
        <Box key={s.shelfId} sx={{ display: "flex", alignItems: "center", pl: 2, pr: 1, py: 0.5 }}>
          <Typography sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
          </Typography>
          <Tooltip title="Move up">
            <span>
              <IconButton size="small" aria-label={`Move ${s.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Move down">
            <span>
              <IconButton
                size="small"
                aria-label={`Move ${s.name} down`}
                disabled={busy || i === shelves.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Rename">
            <IconButton size="small" aria-label={`Rename ${s.name}`} onClick={() => openNaming(s)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" aria-label={`Delete ${s.name}`} onClick={() => setPendingDelete(s)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}

      <Box sx={{ px: 1, pt: 0.5 }}>
        <Button startIcon={<AddIcon />} onClick={() => openNaming("new")}>
          Add shelf
        </Button>
      </Box>

      <Dialog open={naming !== null} onClose={() => !busy && setNaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>{renaming ? "Rename shelf" : "New shelf"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            error={taken}
            helperText={taken ? "You already have a shelf with this name" : undefined}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNaming(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {renaming ? "Rename" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pendingDelete !== null} onClose={() => !busy && setPendingDelete(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete shelf?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{pendingDelete?.name}” is removed from every book on it. The books themselves stay in your library.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" onClick={confirmDelete} disabled={busy}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}
