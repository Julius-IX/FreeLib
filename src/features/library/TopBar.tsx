import { useState } from "react";
import { Box, Chip, Typography, IconButton } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { notify } from "@/util/notify";
import { isDesktop } from "@/util/misc";
import { useLibrary } from "@/LibraryContext";
import SearchField from "./SearchField";

export default function TopBar() {
  const desktop = isDesktop();
  const { books } = useLibrary();
  const [searchOpen, setSearchOpen] = useState(false);

  const searching = !desktop && searchOpen; // mobile search mode
  const showSearchField = desktop || searching;

  const closeSearch = () => setSearchOpen(false);

  return (
    <Box sx={{
      display: "flex",
      alignItems: "center",
      width: "100%",
      gap: 2,
      paddingBottom: 1,
      borderBottom: 1,
      borderColor: "divider",
    }}>
      {searching && (
        <IconButton onClick={closeSearch} edge="start">
          <ArrowBackIcon />
        </IconButton>
      )}

      {!searching && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h5">Library</Typography>
          <Chip label={books.length} size="small" variant="outlined" />
        </Box>
      )}

      {showSearchField && (
        <SearchField autoFocus={searching} />
      )}

      <Box sx={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
        {!desktop && !searchOpen && (
          <IconButton onClick={() => setSearchOpen(true)}>
            <SearchIcon />
          </IconButton>
        )}

        {/* TODO: add button action */}
        <IconButton onClick={() => notify("beep boop searching activated")}>
          <FilterListIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
