import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControlLabel, Switch,
} from "@mui/material";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useOnce } from "@/util/hooks";
import {
  checkOnStartup, closeUpdateDialog, setDismissed, useIsDismissed, useUpdateState,
} from "./updates";

/** Mount once at the app root: runs the startup check and shows the dialog when there's news. */
export function UpdateHost() {
  useOnce(checkOnStartup);
  const { update, open } = useUpdateState();
  const dismissed = useIsDismissed(update?.version ?? "");
  if (!update) return null;

  return (
    <Dialog open={open} onClose={closeUpdateDialog} fullWidth maxWidth="xs">
      <DialogTitle>Update available</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Version {update.version} is out. You're on {update.current}.
        </DialogContentText>
        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Switch
              checked={dismissed}
              onChange={(e) => setDismissed(update.version, e.target.checked)}
            />
          }
          label="Don't show me this again"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={closeUpdateDialog}>Close</Button>
        <Button
          variant="contained"
          onClick={() => {
            openUrl(update.url).catch((e) => console.error("couldn't open the link:", e));
            closeUpdateDialog();
          }}
        >
          View release
        </Button>
      </DialogActions>
    </Dialog>
  );
}
