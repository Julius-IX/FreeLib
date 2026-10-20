import { useEffect, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, TextField } from "@mui/material";
import { RATING_MAX, formatRatingNumber, parseRating } from "../rating";

/**
 * Type an exact rating, fractions included ("7.5", or "7,5"). The icons are for quick taps. This
 * is for everything in between. 0 (or "Clear") takes the rating away.
 */
export function RatingDialog({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  /** The current rating, 0 = not rated. */
  value: number;
  onClose: () => void;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState("");
  // start from the current rating each time it opens
  useEffect(() => {
    if (open) setText(value > 0 ? formatRatingNumber(value) : "");
  }, [open, value]);

  const parsed = parseRating(text);
  const invalid = text.trim() !== "" && parsed === null;

  const submit = () => {
    if (parsed === null) return;
    if (parsed !== value) onSave(parsed);
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Rating</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label="Your rating"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          error={invalid}
          helperText={
            invalid
              ? `Enter a number from 0 to ${RATING_MAX}.`
              : "One decimal is kept (7.5). 0 clears the rating."
          }
          slotProps={{
            htmlInput: { inputMode: "decimal", onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select() },
            input: { endAdornment: <InputAdornment position="end">/{RATING_MAX}</InputAdornment> },
          }}
        />
      </DialogContent>
      <DialogActions>
        {value > 0 && (
          <Button
            color="inherit"
            onClick={() => {
              onSave(0);
              onClose();
            }}
            sx={{ mr: "auto" }}
          >
            Clear
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={parsed === null}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
