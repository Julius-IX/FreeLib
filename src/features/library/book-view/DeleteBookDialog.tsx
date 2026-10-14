import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

export function DeleteBookDialog({
  open,
  title,
  readingCount,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  readingCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const entries = `${readingCount} reading ${readingCount === 1 ? "entry" : "entries"}`;
  return (
    <Dialog open={open} onClose={() => !busy && onCancel()}>
      <DialogTitle>Delete book?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          “{title}” will be permanently removed{readingCount > 0 ? `, along with its ${entries}` : ""}. This cannot be
          undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
