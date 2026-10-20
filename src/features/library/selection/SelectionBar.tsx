import { useEffect, useMemo, useState } from "react";
import { Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import DeselectIcon from "@mui/icons-material/Deselect";
import FlipIcon from "@mui/icons-material/Flip";
import LabelIcon from "@mui/icons-material/Label";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import SyncIcon from "@mui/icons-material/Sync";
import type { Book } from "@/lib/types";
import { type EnrichResult, enrichBooks } from "../book-form/enrichBooks";
import { bumpLibrary } from "../libraryEvents";
import { deleteBook, runBulk } from "./bulkOps";
import {
  type BulkReport,
  type BulkRun,
  BulkRunDialog,
  ConfirmDialog,
  type LinkKind,
  LinkPickDialog,
  bulkReport,
} from "./BulkDialogs";
import type { Selection } from "./useSelection";

type Dialog = "update" | "delete" | LinkKind;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function enrichReport(r: EnrichResult): BulkReport {
  const details: string[] = [];
  if (r.unchanged > 0) details.push(`${r.unchanged} had nothing new`);
  if (r.notFound > 0) details.push(`${r.notFound} not found by any plugin`);
  if (r.noIsbn > 0) details.push(`${r.noIsbn} without a valid ISBN`);
  if (r.covers > 0) details.push(`${plural(r.covers, "cover", "covers")} saved`);
  if (r.failed > 0) details.push(`${r.failed} failed`);
  if (r.stopped === "user") details.push("Stopped before the end");
  if (r.stopped === "failing") details.push("Stopped early because every lookup kept failing");
  details.push(...r.problems);
  return {
    summary: `Updated ${plural(r.updated, "book", "books")} of ${r.total}`,
    details,
    severity: r.total > 0 && r.failed === r.total ? "error" : r.failed > 0 || r.stopped ? "warning" : "success",
  };
}

/**
 * Replaces the library's top bar while books are being selected. Owns the dialogs of the actions,
 * which all work on the selected books in grid order.
 */
export default function SelectionBar({ selection, books }: { selection: Selection; books: Book[] }) {
  const { selected, close, selectAll, deselectAll, invert } = selection;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [run, setRun] = useState<BulkRun | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  const ids = useMemo(() => books.filter((b) => selected.has(b.bookId)).map((b) => b.bookId), [books, selected]);
  const count = ids.length;
  const none = count === 0;
  const allSelected = books.length > 0 && count === books.length;
  const busy = dialog !== null || run !== null || menu !== null;

  // Esc leaves the mode and Ctrl+A selects everything. Open dialogs and menus handle their own keys.
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, [contenteditable]")) return;
        e.preventDefault();
        selectAll(books);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close, selectAll, books]);

  const start = (op: BulkRun) => {
    setDialog(null);
    setRun(op);
  };

  const startUpdate = () =>
    start({
      title: "Updating details",
      total: count,
      run: async ({ onProgress, shouldStop }) => {
        const result = await enrichBooks(ids, { onProgress: (p) => onProgress(p.done), shouldStop });
        bumpLibrary(result.coverIds);
        return enrichReport(result);
      },
    });

  const startDelete = () =>
    start({
      title: "Deleting books",
      total: count,
      run: async ({ onProgress, shouldStop }) => {
        try {
          const summary = await runBulk(ids, deleteBook, { onProgress: (p) => onProgress(p.done), shouldStop });
          return bulkReport(summary, "Deleted");
        } finally {
          bumpLibrary([]);
        }
      },
    });

  const openFromMenu = (next: Dialog) => {
    setMenu(null);
    setDialog(next);
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 1,
        paddingBottom: 1,
        marginBottom: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <IconButton aria-label="Cancel selection" edge="start" onClick={close}>
        <CloseIcon />
      </IconButton>
      <Typography variant="h6" noWrap>
        {count} selected
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
        <Tooltip title={allSelected ? "Deselect all" : "Select all"}>
          <IconButton aria-label={allSelected ? "Deselect all" : "Select all"} onClick={() => (allSelected ? deselectAll() : selectAll(books))}>
            {allSelected ? <DeselectIcon /> : <SelectAllIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Update details from plugins">
          <span>
            <IconButton aria-label="Update details from plugins" disabled={none} onClick={() => setDialog("update")}>
              <SyncIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete">
          <span>
            <IconButton aria-label="Delete" disabled={none} onClick={() => setDialog("delete")}>
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton aria-label="More actions" onClick={(e) => setMenu(e.currentTarget)}>
          <MoreVertIcon />
        </IconButton>
      </Box>

      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem disabled={none} onClick={() => openFromMenu("tags")}>
          <ListItemIcon>
            <LocalOfferIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Tags…</ListItemText>
        </MenuItem>
        <MenuItem disabled={none} onClick={() => openFromMenu("categories")}>
          <ListItemIcon>
            <LabelIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Categories…</ListItemText>
        </MenuItem>
        <MenuItem disabled={none} onClick={() => openFromMenu("shelves")}>
          <ListItemIcon>
            <LibraryBooksIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Shelves…</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setMenu(null);
            invert(books);
          }}
        >
          <ListItemIcon>
            <FlipIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Invert selection</ListItemText>
        </MenuItem>
      </Menu>

      {dialog === "update" && (
        <ConfirmDialog
          title="Update details?"
          confirmLabel="Update"
          onCancel={() => setDialog(null)}
          onConfirm={startUpdate}
        >
          The lookup plugins are asked about {plural(count, "selected book", "selected books")} and fill in what is
          missing. Details a book already has are kept. This needs an internet connection and can take a while.
        </ConfirmDialog>
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete ${plural(count, "book", "books")}?`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={startDelete}
        >
          {plural(count, "book", "books")} will be permanently removed, along with the reading history and the
          covers. This cannot be undone.
        </ConfirmDialog>
      )}
      {(dialog === "tags" || dialog === "categories" || dialog === "shelves") && (
        <LinkPickDialog kind={dialog} bookIds={ids} onCancel={() => setDialog(null)} onStart={start} />
      )}
      {run && <BulkRunDialog op={run} onClose={() => setRun(null)} />}
    </Box>
  );
}
