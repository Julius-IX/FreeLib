import { ReactNode, useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogTitle, List, ListItemButton, ListItemText,
  Radio, Slider, Switch, Typography,
} from "@mui/material";

/**
 * Building blocks for the settings page, modelled on Tachiyomi's preference screens:
 * a primary-coloured section header, then full-width rows with a title and a summary line.
 */

const rowPadding = { px: 2, py: 1.5 };

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ pb: 1 }}>
      <Typography
        variant="subtitle2"
        color="primary"
        sx={{ px: 2, pt: 2, pb: 0.5, fontWeight: 600 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * One row. With `onClick` the whole row is tappable. Otherwise it's a plain row, and
 * `children` (a slider, swatches, ...) are shown under the text.
 */
export function Preference({
  title,
  summary,
  onClick,
  children,
}: {
  title: string;
  summary?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const text = <ListItemText primary={title} secondary={summary} sx={{ m: 0 }} />;
  if (onClick) {
    return <ListItemButton onClick={onClick} sx={rowPadding}>{text}</ListItemButton>;
  }
  return (
    <Box sx={rowPadding}>
      {text}
      {children && <Box sx={{ mt: 1 }}>{children}</Box>}
    </Box>
  );
}

/** A row with an on/off switch. The whole row toggles it. */
export function SwitchPreference({
  title,
  summary,
  checked,
  onChange,
}: {
  title: string;
  summary?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <ListItemButton onClick={() => onChange(!checked)} sx={rowPadding}>
      <ListItemText primary={title} secondary={summary} sx={{ m: 0, pr: 2 }} />
      <Switch edge="end" checked={checked} disableRipple tabIndex={-1} />
    </ListItemButton>
  );
}

/** Tap the row, pick one option from a dialog (like Tachiyomi's list preference). */
export function SelectPreference<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Preference
        title={title}
        summary={options.find((o) => o.value === value)?.label}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>{title}</DialogTitle>
        <List sx={{ pt: 0 }}>
          {options.map((o) => (
            <ListItemButton
              key={o.value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              <Radio
                edge="start"
                checked={o.value === value}
                disableRipple
                tabIndex={-1}
                sx={{ mr: 1 }}
              />
              <ListItemText primary={o.label} />
            </ListItemButton>
          ))}
        </List>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** A slider row. Follows the thumb while dragging, but only saves when it's let go. */
export function SliderPreference({
  title,
  summary,
  value,
  min,
  max,
  onCommit,
}: {
  title: string;
  summary?: (value: number) => string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Preference title={title} summary={summary?.(draft)}>
      <Slider
        value={draft}
        onChange={(_, v) => setDraft(v as number)}
        onChangeCommitted={(_, v) => onCommit(v as number)}
        min={min}
        max={max}
        step={1}
        marks
        valueLabelDisplay="auto"
        sx={{ display: "block", mx: 1, width: "calc(100% - 16px)" }}
      />
    </Preference>
  );
}
