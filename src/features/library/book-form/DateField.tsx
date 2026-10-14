import { useRef, useState } from "react";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { normalizeDate } from "./inputs";

// Not every webview can open the native date picker; without it the field is type-only.
const canShowPicker = typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype;

/**
 * Type a date (YYYY-MM-DD) or, where the webview supports it, pick one from the calendar button.
 * With `partial`, a bare year or year-month is fine too.
 */
export function DateField({
  value,
  onChange,
  invalid,
  label = "Publish date",
  partial = false,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  label?: string;
  partial?: boolean;
}) {
  const [touched, setTouched] = useState(invalid); // no error while still typing, but show a bad prefill right away
  const pickerRef = useRef<HTMLInputElement>(null);
  const showError = touched && invalid;

  return (
    <TextField
      label={label}
      placeholder={partial ? "YYYY or YYYY-MM-DD" : "YYYY-MM-DD"}
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setTouched(true)}
      error={showError}
      helperText={showError ? (partial ? "Use YYYY, YYYY-MM or YYYY-MM-DD" : "Use the format YYYY-MM-DD") : undefined}
      slotProps={{
        input: {
          endAdornment: canShowPicker ? (
            <InputAdornment position="end" sx={{ position: "relative" }}>
              <IconButton
                aria-label="Pick a date"
                edge="end"
                onClick={() => {
                  try {
                    pickerRef.current?.showPicker();
                  } catch {
                    /* picker unavailable right now, typing still works */
                  }
                }}
              >
                <CalendarMonthIcon />
              </IconButton>
              {/* invisible native input, only here to open the calendar and hand back a date */}
              <input
                ref={pickerRef}
                type="date"
                value={normalizeDate(value) ?? ""}
                onChange={(e) => onChange(e.target.value)}
                tabIndex={-1}
                aria-hidden
                style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              />
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
