import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Box, InputBase } from "@mui/material";
import ReactMarkdown from "react-markdown";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Fires when the field loses focus (a good moment to save). */
  onBlur?: () => void;
  placeholder?: string;
  /** Open with the keyboard / caret ready instead of the rendered view. */
  startEditing?: boolean;
};

/**
 * One surface that fills its parent. Focused (or empty): a borderless text area for typing
 * directly. Unfocused with text: the same text rendered as markdown. Tapping it switches back to editing.
 * There's no edit/save mode, the parent gets every change through onChange.
 */
export function NotesEditor({ value, onChange, onBlur, placeholder = "Add notes…", startEditing = false }: Props) {
  const [editing, setEditing] = useState(startEditing);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const showInput = editing || value.trim() === "";

  const onPreviewClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a")) return; // let links be links
    setEditing(true);
  };

  return (
    <Box
      // empty space below the text still counts as "the text field"
      onClick={(e) => {
        if (showInput && e.target === e.currentTarget) inputRef.current?.focus();
      }}
      sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, py: 1.5, cursor: "text" }}
    >
      {showInput ? (
        <InputBase
          multiline
          fullWidth
          autoFocus
          inputRef={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            const el = e.target as HTMLTextAreaElement;
            el.setSelectionRange(el.value.length, el.value.length); // caret at the end, not the start
          }}
          onBlur={() => {
            setEditing(false);
            onBlur?.();
          }}
          sx={{ alignItems: "flex-start", fontSize: "1rem", lineHeight: 1.6, p: 0 }}
        />
      ) : (
        <Box
          onClick={onPreviewClick}
          sx={{
            minHeight: "100%",
            overflowWrap: "anywhere",
            "& > :first-of-type": { mt: 0 },
            "& img": { maxWidth: "100%" },
            "& pre": { overflowX: "auto", p: 1, borderRadius: 1, bgcolor: "action.hover" },
            "& code": { fontFamily: "monospace" },
            "& blockquote": { m: 0, pl: 1.5, borderLeft: 3, borderColor: "divider", color: "text.secondary" },
            "& a": { color: "primary.main" },
          }}
        >
          <ReactMarkdown>{value}</ReactMarkdown>
        </Box>
      )}
    </Box>
  );
}
