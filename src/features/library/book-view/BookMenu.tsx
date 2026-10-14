import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";

type Props = {
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Start read is blocked while a read is open, End read while none is. */
  reading: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onEnd: () => void;
};

export function BookMenu({ anchor, onClose, reading, busy, onEdit, onDelete, onStart, onEnd }: Props) {
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose}>
      <MenuItem onClick={onEdit}>
        <ListItemIcon>
          <EditIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Edit</ListItemText>
      </MenuItem>
      <MenuItem onClick={onDelete} sx={{ color: "error.main" }}>
        <ListItemIcon sx={{ color: "inherit" }}>
          <DeleteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Delete</ListItemText>
      </MenuItem>
      <MenuItem onClick={onStart} disabled={reading || busy}>
        <ListItemIcon>
          <PlayArrowIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Start read</ListItemText>
      </MenuItem>
      <MenuItem onClick={onEnd} disabled={!reading || busy}>
        <ListItemIcon>
          <StopIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>End read</ListItemText>
      </MenuItem>
    </Menu>
  );
}
