import { useCallback, useEffect, useRef, useState } from "react";
import { InputAdornment, TextField } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { BookFilter } from "@/lib/types";
import { parseQuery } from "../search";
import { libraryViewState } from "../libraryViewState";
import { useLibrary } from "../LibraryContext";

export default function SearchField({ autoFocus }: { autoFocus?: boolean }) {
  const { setFilter } = useLibrary();
  const [text, setText] = useState(() => libraryViewState.searchText);

  // Skip no-op emits (trailing spaces, initial empty state).
  const last = useRef(JSON.stringify(libraryViewState.filter));
  const emit = useCallback(
    (f: BookFilter) => {
      const key = JSON.stringify(f);
      if (key === last.current) return;
      last.current = key;
      setFilter(f);
    },
    [setFilter],
  );

  useEffect(() => {
    const id = setTimeout(() => emit(parseQuery(text)), 250);
    return () => clearTimeout(id);
  }, [text, emit]);

  return (
    <TextField
      autoFocus={autoFocus}
      value={text}
      onChange={(e) => {
        libraryViewState.searchText = e.target.value;
        setText(e.target.value);
      }}
      placeholder="tag:fantasy  author:'Le Guin' has:cover !rating:>3"
      variant="standard"
      sx={{ flex: 1 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
