import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InputAdornment, TextField } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { BookFilter } from "@/lib/types";
import { type Suggestion, parseQuery, suggest } from "../search";
import { libraryViewState } from "../libraryViewState";
import { useLibrary } from "../LibraryContext";
import SearchSuggestions from "./SearchSuggestions";

export default function SearchField({ autoFocus }: { autoFocus?: boolean }) {
  const { setFilter } = useLibrary();
  const [text, setText] = useState(() => libraryViewState.searchText);
  const [caret, setCaret] = useState(text.length);
  const [focused, setFocused] = useState(false);
  // Escape hides the list until the next edit.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

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

  const suggestions = useMemo(
    () => (focused && !dismissed ? suggest(text, caret) : null),
    [focused, dismissed, text, caret],
  );

  // A picked suggestion changes the text, so the caret can only be placed once it is rendered.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const edit = (value: string, at: number) => {
    libraryViewState.searchText = value;
    setText(value);
    setCaret(at);
    setDismissed(false);
    setActive(-1);
  };

  const pick = (s: Suggestion) => {
    if (!suggestions) return;
    const { from, to } = suggestions;
    const at = from + s.text.length;
    pendingCaret.current = at;
    edit(text.slice(0, from) + s.text + text.slice(to), at);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = suggestions?.items.length;
    if (!suggestions || !count) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (a + 1) % count);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (a <= 0 ? count : a) - 1);
        break;
      case "Enter":
      case "Tab":
        // Only with an entry picked by the arrows, so Tab still moves on in all other cases.
        if (active < 0) return;
        e.preventDefault();
        pick(suggestions.items[active]);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        break;
    }
  };

  return (
    <>
      <TextField
        ref={anchor}
        inputRef={input}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
          htmlInput: {
            // The browser's own history dropdown would sit on top of the suggestions.
            autoComplete: "off",
            // Fires on caret moves that are not edits (arrow keys, taps), which change what is suggested.
            onSelect: (e: React.SyntheticEvent<HTMLInputElement>) => {
              const at = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
              if (at === caret) return;
              setCaret(at);
              setActive(-1);
            },
          },
        }}
      />
      {suggestions && anchor.current && (
        <SearchSuggestions anchor={anchor.current} items={suggestions.items} active={active} onPick={pick} />
      )}
    </>
  );
}
