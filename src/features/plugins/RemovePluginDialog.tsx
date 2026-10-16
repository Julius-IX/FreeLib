import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

export function RemovePluginDialog({
  open,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={() => !busy && onCancel()}>
      <DialogTitle>Remove plugin?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          “{name}” will be deleted from this device. If it replaced a built-in plugin, the built-in comes back.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" onClick={onConfirm} disabled={busy}>
          {busy ? "Removing…" : "Remove"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
