import { useEffect, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, List, ListItemButton, ListItemIcon, ListItemText,
} from "@mui/material";
import ShelvesIcon from '@mui/icons-material/Shelves';
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { bumpLibrary, useLibraryRevision } from "../libraryEvents";
import { useShelves } from "./useShelves";

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The book page's "put this on a shelf" button (Tachiyomi's heart). Tinted while the book is on
 * at least one shelf. Tapping it opens a checklist of every shelf. A book can be on any number
 * of them. Shelves themselves are made in Settings, so with none defined the dialog says so.
 */
export function ShelfButton({ bookId }: { bookId: number }) {
  const { shelves } = useShelves();
  const revision = useLibraryRevision();
  const [saved, setSaved] = useState<number[]>([]);
  const [draft, setDraft] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    commands.db_crud
      .getBookShelves({ bookId })
      .then((rows) => {
        if (!stale) setSaved(rows.map((s) => s.shelfId));
      })
      .catch((e) => console.error("ShelfButton: couldn't load the book's shelves", e));
    return () => {
      stale = true;
    };
  }, [bookId, revision]);

  const close = () => !busy && setOpen(false);
  const toggle = (id: number) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const save = async () => {
    setBusy(true);
    try {
      await commands.db_crud.setBookShelves({ bookId, shelfIds: draft });
      setSaved(draft);
      setOpen(false);
      bumpLibrary([]); // the library's tabs (and the Unshelved tab) may change
    } catch (e) {
      notify(`Couldn't save shelves: ${String(e)}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        aria-label="Shelves"
        aria-pressed={saved.length > 0}
        color={saved.length > 0 ? "primary" : "default"}
        onClick={() => {
          setDraft(saved);
          setOpen(true);
        }}
      >
        <ShelvesIcon />
      </IconButton>

      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>Shelves</DialogTitle>
        {shelves.length === 0 ? (
          <DialogContent>
            <DialogContentText>
              You haven't made any shelves yet. Add some under Settings → Shelves.
            </DialogContentText>
          </DialogContent>
        ) : (
          <List sx={{ pt: 0, maxHeight: "50dvh", overflowY: "auto" }}>
            {shelves.map((s) => (
              <ListItemButton key={s.shelfId} onClick={() => toggle(s.shelfId)} disabled={busy}>
                <ListItemIcon sx={{ minWidth: 0, mr: 1 }}>
                  <Checkbox edge="start" checked={draft.includes(s.shelfId)} disableRipple tabIndex={-1} />
                </ListItemIcon>
                <ListItemText primary={s.name} />
              </ListItemButton>
            ))}
          </List>
        )}
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            {shelves.length === 0 ? "Close" : "Cancel"}
          </Button>
          {shelves.length > 0 && (
            <Button onClick={save} disabled={busy || sameSet(draft, saved)}>
              Save
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
