import { useEffect, useState } from "react";
import { commands } from "@/lib/commands";
import type { Category } from "@/lib/types";
import { CategoryChip } from "@/components/CategoryChip";
import { TagField } from "@/components/TagField";
import { notify } from "@/notifications/notify";
import { useCategoryStyle } from "../categoryStyle";

/**
 * The tag field, pick-only (no `parseInput` / `onCreate`): categories can't be typed in here.
 * They're made (name + colour) under "Update filter fields" so every one always has a colour.
 */
export function CategoryField({ value, onChange }: { value: Category[]; onChange: (next: Category[]) => void }) {
  const [style] = useCategoryStyle();
  const [options, setOptions] = useState<Category[]>([]);
  useEffect(() => {
    commands.db_crud
      .listCategories()
      .then(setOptions)
      .catch((e) => notify(`Couldn't load categories: ${String(e)}`, { severity: "error" }));
  }, []);

  return (
    <TagField<Category>
      label="Categories"
      value={value}
      onChange={onChange}
      options={options}
      getLabel={(c) => c.name}
      getKey={(c) => c.categoryId}
      renderChip={(c, chipProps) => <CategoryChip {...chipProps} category={c} variant={style} base="filled" size="medium" />}
      renderOption={(c) => <CategoryChip category={c} variant={style} base="filled" />}
      helperText="Add or recolor categories in Update Filter Fields"
      noOptionsText="No categories to pick. Create them in Update Filter Fields"
    />
  );
}
