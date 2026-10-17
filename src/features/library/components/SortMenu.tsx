import { useState } from "react";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import SortIcon from "@mui/icons-material/Sort";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import type { SortKey } from "@/lib/types";
import { useLibrary } from "../LibraryContext";
import { SORT_INFO, SORT_KEYS } from "../librarySort";

export default function SortMenu() {
  const { sort, setSort } = useLibrary();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  // Picking the current key flips its direction; a new key starts in its own natural one.
  const pick = (key: SortKey) => {
    setSort(
      key === sort.by
        ? { by: key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { by: key, dir: SORT_INFO[key].dir },
    );
    close();
  };

  return (
    <>
      <Tooltip title="Sort">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
          <SortIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {SORT_KEYS.map((key) => {
          const selected = key === sort.by;
          return (
            <MenuItem key={key} selected={selected} onClick={() => pick(key)}>
              <ListItemText>{SORT_INFO[key].label}</ListItemText>
              {selected && (
                <ListItemIcon sx={{ ml: 2, minWidth: 0 }}>
                  {sort.dir === "asc" ? (
                    <ArrowUpwardIcon fontSize="small" />
                  ) : (
                    <ArrowDownwardIcon fontSize="small" />
                  )}
                </ListItemIcon>
              )}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
