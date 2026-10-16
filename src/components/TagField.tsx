import { Autocomplete, Chip, CircularProgress, TextField } from "@mui/material";
import CancelIcon from "@mui/icons-material/Cancel"; // round X
import { useRef, useState } from "react";

export type TagFieldProps<T> = {
  label?: string;

  // Controlled: the parent owns the chips, so they're always accessible.
  value: T[];
  onChange: (next: T[]) => void;

  // Controlled suggestions: suggestions that the user can pick from
  options: T[];
  loading?: boolean;
  /** Fires as the user types. If provided, filtering is assumed to be
   *  server-side and MUI's built-in client filtering is turned off. */
  onSearch?: (text: string) => void;

  getLabel: (item: T) => string;
  getKey?: (item: T) => string | number; // defaults to the label

  /** Sync: typed text -> item (null rejects). */
  parseInput?: (text: string) => T | null;
  /** Async: create an item from typed text that matches no option
   *  (e.g. insert into the DB and return the saved row). Null rejects. */
  onCreate?: (text: string) => Promise<T | null>;
  // Providing parseInput and/or onCreate enables free text. Omit both for pick-only.

  onChipClick?: (item: T) => void;
  /** Called when the X is clicked (or backspace removes a chip). Return false to veto. */
  onChipRemove?: (item: T) => boolean | void;
  removeOnHover?: boolean; // X only visible while hovering (default true)
  /** No X button; clicking a chip removes it (takes priority over onChipClick). */
  removeOnClick?: boolean;
  confirmOnSpace?: boolean; // space commits typed text (default true, needs free text)
};

export function TagField<T>({
  label,
  value,
  onChange,
  options,
  loading,
  onSearch,
  getLabel,
  getKey,
  parseInput,
  onCreate,
  onChipClick,
  onChipRemove,
  removeOnHover = true,
  removeOnClick = false,
  confirmOnSpace = true,
}: TagFieldProps<T>) {
  const [input, setInput] = useState("");

  // addItem can await onCreate, so read the latest value after the await.
  const valueRef = useRef(value);
  valueRef.current = value;

  const allowFreeText = !!(parseInput || onCreate);
  const keyOf = (item: T) => getKey?.(item) ?? getLabel(item);
  const labelOf = (v: T | string) => (typeof v === "string" ? v : getLabel(v));

  const removeItem = (item: T) => {
    if (onChipRemove?.(item) === false) return;
    onChange(valueRef.current.filter((v) => keyOf(v) !== keyOf(item)));
  };

  // Accepts a picked option (T) or free text (string).
  const addItem = async (raw: T | string) => {
    let item: T | null;
    if (typeof raw === "string") {
      item =
        options.find((o) => getLabel(o).toLowerCase() === raw.toLowerCase()) ??
        parseInput?.(raw) ??
        (onCreate ? await onCreate(raw) : null);
    } else {
      item = raw;
    }
    if (item === null) return;
    const current = valueRef.current;
    if (current.some((v) => keyOf(v) === keyOf(item!))) return; // dupe
    onChange([...current, item]);
  };

  return (
    <Autocomplete<T | string, true, false, boolean>
      multiple
      freeSolo={allowFreeText}
      autoSelect={allowFreeText}
      filterSelectedOptions
      loading={loading}
      options={options}
      filterOptions={onSearch ? (x) => x : undefined}
      value={value}
      onChange={(_, next, reason) => {
        if (reason === "clear") {
          // keep only the chips whose removal got vetoed
          onChange(value.filter((v) => onChipRemove?.(v) === false));
        } else if (reason === "removeOption") {
          // backspace: find what disappeared and route it through removeItem
          const removed = value.find((v) => !next.includes(v));
          if (removed !== undefined) removeItem(removed);
        } else {
          // selecting / Enter / blur: the only new entry is the last one
          const added = next[next.length - 1];
          setInput("");
          if (added !== undefined) void addItem(added);
        }
      }}
      inputValue={input}
      onInputChange={(_, v, reason) => {
        setInput(v);
        if (reason === "input") onSearch?.(v);
      }}
      getOptionLabel={labelOf}
      isOptionEqualToValue={(a, b) =>
        (typeof a === "string" ? a : keyOf(a)) ===
        (typeof b === "string" ? b : keyOf(b))
      }
      renderValue={(vals, getItemProps) =>
        (vals as T[]).map((item, index) => {
          // drop MUI's onDelete so removal goes through our own callback
          const { key, onDelete: _ignored, ...itemProps } = getItemProps({ index });
          return (
            <Chip
              key={key}
              label={getLabel(item)}
              {...itemProps}
              onClick={
                removeOnClick
                  ? () => removeItem(item)
                  : onChipClick
                    ? () => onChipClick(item)
                    : undefined
              }
              onDelete={removeOnClick ? undefined : () => removeItem(item)}
              deleteIcon={<CancelIcon />}
              sx={
                removeOnHover && !removeOnClick
                  ? {
                    "& .MuiChip-deleteIcon": { opacity: 0, transition: "opacity .15s" },
                    "&:hover .MuiChip-deleteIcon": { opacity: 1 },
                    // no hover on touch devices, so always show it there
                    "@media (hover: none)": { "& .MuiChip-deleteIcon": { opacity: 1 } },
                  }
                  : undefined
              }
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          slotProps={{
            ...params.slotProps, // keeps htmlInput (ref, aria props, etc.)
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
          onKeyDown={(e) => {
            if (confirmOnSpace && allowFreeText && e.key === " " && input.trim()) {
              e.preventDefault();
              void addItem(input.trim());
              setInput("");
            }
          }}
        />
      )}
    />
  );
}
