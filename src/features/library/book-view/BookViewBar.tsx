import type { MouseEvent, ReactNode } from "react";
import { Box, IconButton } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";

export function BookViewBar({
  onBack,
  onMenu,
  actions,
}: {
  onBack: () => void;
  onMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Extra buttons, shown left of the menu button. */
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        px: 0.5,
        py: 0.5,
        bgcolor: "background.default",
      }}
    >
      <IconButton aria-label="Back" onClick={onBack}>
        <ArrowBackIcon />
      </IconButton>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        {actions}
        {onMenu && (
          <IconButton aria-label="More options" onClick={onMenu}>
            <MoreVertIcon />
          </IconButton>
        )}
      </Box>
    </Box>
  );
}
