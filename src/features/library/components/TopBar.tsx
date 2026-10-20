import { useState } from "react";
import { Box, Chip, Typography, IconButton } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { isDesktop } from "@/util/misc";
import { useLibrary } from "../LibraryContext";
import SearchField from "./SearchField";
import SortMenu from "./SortMenu";
import { emptyFilter } from "../search";
import { libraryViewState } from "../libraryViewState";

export default function TopBar() {
  const desktop = isDesktop();
  const { books, setFilter } = useLibrary();
  const [searchOpen, setSearchOpenState] = useState(() => libraryViewState.searchOpen);
  const setSearchOpen = (open: boolean) => {
    libraryViewState.searchOpen = open;
    setSearchOpenState(open);
  };

  const searching = !desktop && searchOpen; // mobile search mode
  const showSearchField = desktop || searching;

  // Closing the field clears the search. Merely leaving the screen keeps it.
  const closeSearch = () => {
    libraryViewState.searchText = "";
    setFilter(emptyFilter());
    setSearchOpen(false);
  };

  return (
    <Box sx={{
      display: "flex",
      alignItems: "center",
      width: "100%",
      gap: 2,
      paddingBottom: 1,
      marginBottom: 1,
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
        <SortMenu />
      </Box>
    </Box>
  );
}
