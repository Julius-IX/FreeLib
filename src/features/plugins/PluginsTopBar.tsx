import { Box, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

/** Same look as the library's top bar: title on the left, actions on the right. */
export default function PluginsTopBar({ onInstall, busy }: { onInstall: () => void; busy: boolean }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 2,
        paddingBottom: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="h5">Plugins</Typography>

      <Box sx={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
        <Tooltip title="Install plugin">
          {/* span: a disabled button can't show a tooltip by itself */}
          <span>
            <IconButton aria-label="Install a plugin" onClick={onInstall} disabled={busy} edge="end">
              {busy ? <CircularProgress size={24} /> : <AddIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
