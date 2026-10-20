import { useEffect, useMemo, useState } from "react";
import { Autocomplete, TextField, createFilterOptions } from "@mui/material";
import { commands } from "@/lib/commands";
import { notify } from "@/notifications/notify";
import { choiceKey } from "./choice";
import type { Choice } from "./types";

export type CreateOption = { inputValue: string };
export type SeriesOption = Choice | CreateOption;
export const isCreate = (o: SeriesOption): o is CreateOption => "inputValue" in o;
export const filter = createFilterOptions<SeriesOption>();

export function SeriesField({ value, onChange }: { value: Choice | null; onChange: (c: Choice | null) => void }) {
  const [existing, setExisting] = useState<Choice[]>([]);
  useEffect(() => {
    commands.db_crud
      .listSeries()
      .then((list) => setExisting(list.map((s) => ({ id: s.seriesId, name: s.name }))))
      .catch((e) => notify(`Couldn't load series: ${String(e)}`, { severity: "error" }));
  }, []);

  // a draft isn't in the loaded list, add it so MUI can find the selected value
  const options = useMemo(
    () => (value && value.id === null ? [...existing, value] : existing),
    [existing, value]
  );

  return (
    <Autocomplete<SeriesOption, false, false, false>
      options={options}
      value={value}
      onChange={(_, next) => {
        if (next === null) onChange(null);
        else if (isCreate(next)) onChange({ id: null, name: next.inputValue });
        else onChange(next);
      }}
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params);
        const text = params.inputValue.trim();
        const exists = opts.some((o) => !isCreate(o) && o.name.toLowerCase() === text.toLowerCase());
        if (text && !exists) filtered.push({ inputValue: text });
        return filtered;
      }}
      getOptionLabel={(o) => (isCreate(o) ? o.inputValue : o.name)}
      isOptionEqualToValue={(a, b) => !isCreate(a) && !isCreate(b) && choiceKey(a) === choiceKey(b)}
      renderOption={(props, o) => {
        const { key, ...rest } = props;
        return (
          <li key={key} {...rest}>
            {isCreate(o) ? `Create "${o.inputValue}"` : o.name}
          </li>
        );
      }}
      renderInput={(params) => <TextField {...params} label="Series" />}
    />
  );
}
