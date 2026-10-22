import { useEffect, useRef } from "react";
import { List, ListItemButton, Paper, Popper, Typography } from "@mui/material";
import type { Suggestion } from "../search";

type Props = {
  anchor: HTMLElement;
  items: Suggestion[];
  /** Index of the entry picked with the arrow keys, -1 for none. */
  active: number;
  onPick: (s: Suggestion) => void;
};

/**
 * The list under the search field with the syntax that can be typed next. It never takes focus,
 * so the input keeps its caret and the on-screen keyboard stays up.
 */
export default function SearchSuggestions({ anchor, items, active, onPick }: Props) {
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      sx={{ zIndex: "modal", width: anchor.clientWidth }}
    >
      <Paper
        elevation={8}
        // Keeps the focus in the input, also when the scrollbar is grabbed. The pick happens on click.
        onMouseDown={(e) => e.preventDefault()}
        sx={{ mt: 0.5, maxHeight: 264, overflowY: "auto" }}
      >
        <List ref={list} dense disablePadding role="listbox">
          {items.map((s, i) => (
            <ListItemButton
              key={s.text}
              role="option"
              aria-selected={i === active}
              selected={i === active}
              onClick={() => onPick(s)}
              sx={{ gap: 2 }}
            >
              <Typography component="span" sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {s.text}
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ ml: "auto" }}>
                {s.summary}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      </Paper>
    </Popper>
  );
}
