import { useEffect, useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Autocomplete, Box, Chip, FormControlLabel, MenuItem,
  Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { commands } from "@/lib/commands";
import type { Category, ReadStatus, Tag } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { useLibraryRevision } from "@/features/library/libraryEvents";
import { useShelves } from "@/features/library/shelves/useShelves";
import { GROUPS, MEASURES, PRESETS, type StatsForm, groupInfo } from "./options";

type Choice = { id: number; name: string };

const STATUSES: { id: ReadStatus | "any"; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "unread", label: "Unread" },
  { id: "inProgress", label: "Reading" },
  { id: "finished", label: "Finished" },
];

const LIMITS = [5, 10, 20];

/** Categories and tags, read again when the library changes. Shelves have a hook of their own. */
function useChoices() {
  const revision = useLibraryRevision();
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let stale = false;
    Promise.all([commands.db_crud.listCategories(), commands.db_crud.listTags()])
      .then(([c, t]) => {
        if (stale) return;
        setCategories(c);
        setTags(t);
      })
      .catch((e) => !stale && notify(`Couldn't load the filter choices: ${String(e)}`, { severity: "error" }));
    return () => {
      stale = true;
    };
  }, [revision]);

  return { categories, tags };
}

function IdPicker({ label, options, value, onChange }: {
  label: string; options: Choice[]; value: number[]; onChange: (ids: number[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      size="small"
      options={options}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      value={options.filter((o) => value.includes(o.id))}
      onChange={(_, picked) => onChange(picked.map((o) => o.id))}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

const activeFilters = (f: StatsForm) =>
  [f.status, f.shelfIds.length, f.categoryIds.length, f.tagIds.length, f.search.trim()].filter(Boolean).length;

/** The question, put together from pickers. No query language to learn, and the search box takes
 * the library's own syntax for anything the pickers don't cover. */
export default function StatsBuilder({ form, onChange }: { form: StatsForm; onChange: (patch: Partial<StatsForm>) => void }) {
  const { shelves } = useShelves();
  const { categories, tags } = useChoices();
  const filters = activeFilters(form);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} onClick={() => onChange(p.set)} variant="outlined" />
        ))}
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <TextField select size="small" label="Show" value={form.measure} onChange={(e) => onChange({ measure: e.target.value as StatsForm["measure"] })}>
          {MEASURES.map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Grouped by" value={form.groupBy}
          onChange={(e) => onChange({ groupBy: e.target.value as StatsForm["groupBy"], chart: null })}
        >
          {GROUPS.map((g) => <MenuItem key={g.id} value={g.id}>{g.label}</MenuItem>)}
        </TextField>
      </Box>

      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography>{filters ? `Filters (${filters})` : "Filters"}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <ToggleButtonGroup
            exclusive fullWidth size="small" value={form.status ?? "any"}
            onChange={(_, v: ReadStatus | "any" | null) => v && onChange({ status: v === "any" ? null : v })}
          >
            {STATUSES.map((s) => <ToggleButton key={s.id} value={s.id}>{s.label}</ToggleButton>)}
          </ToggleButtonGroup>

          <IdPicker label="Shelves" options={shelves.map((s) => ({ id: s.shelfId, name: s.name }))} value={form.shelfIds} onChange={(shelfIds) => onChange({ shelfIds })} />
          <IdPicker label="Categories" options={categories.map((c) => ({ id: c.categoryId, name: c.name }))} value={form.categoryIds} onChange={(categoryIds) => onChange({ categoryIds })} />
          <IdPicker label="Tags" options={tags.map((t) => ({ id: t.tagId, name: t.name }))} value={form.tagIds} onChange={(tagIds) => onChange({ tagIds })} />

          <TextField
            size="small" label="Search" value={form.search} onChange={(e) => onChange({ search: e.target.value })}
            helperText="Same search as the library, for example author:herbert pages:>300"
          />

          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
            {groupInfo(form.groupBy).bySize && (
              <TextField
                select size="small" label="Show top" sx={{ minWidth: 120 }} value={form.limit ?? "all"}
                onChange={(e) => onChange({ limit: e.target.value === "all" ? null : Number(e.target.value) })}
              >
                {LIMITS.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                <MenuItem value="all">All</MenuItem>
              </TextField>
            )}
            <FormControlLabel
              control={<Switch checked={form.includeEmpty} onChange={(e) => onChange({ includeEmpty: e.target.checked })} />}
              label="Count books without a value"
            />
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
