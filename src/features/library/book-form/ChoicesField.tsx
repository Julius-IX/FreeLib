import { useEffect, useMemo, useState } from "react";
import { commands } from "@/lib/commands";
import { TagField } from "@/components/TagField";
import { notify } from "@/notifications/notify";
import { choiceKey, toDraft } from "./choice";
import type { Choice } from "./types";

// Module-level so their identity is stable for ChoicesField's effect.
export const loadAuthors = async (): Promise<Choice[]> =>
  (await commands.db_crud.listAuthors()).map((a) => ({ id: a.authorId, name: a.name }));
export const loadTags = async (): Promise<Choice[]> =>
  (await commands.db_crud.listTags()).map((t) => ({ id: t.tagId, name: t.name }));

/** Chips field for authors / tags. Typed names become drafts (id: null), nothing is saved here. */
export function ChoicesField({
  label,
  load,
  value,
  onChange,
  confirmOnSpace,
  removeOnClick,
  normalize,
}: {
  label: string;
  load: () => Promise<Choice[]>;
  value: Choice[];
  onChange: (next: Choice[]) => void;
  confirmOnSpace?: boolean;
  removeOnClick?: boolean;
  /** Applied to every name typed in (tags: lower-case). Existing options are left as they are. */
  normalize?: (name: string) => string;
}) {
  const [options, setOptions] = useState<Choice[]>([]);
  useEffect(() => {
    load()
      .then(setOptions)
      .catch((e) => notify(`Couldn't load ${label.toLowerCase()}: ${String(e)}`, { severity: "error" }));
  }, [load, label]);

  const parseInput = useMemo(() => (text: string) => toDraft(text, normalize), [normalize]);

  return (
    <TagField<Choice>
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      getLabel={(c) => c.name}
      getKey={choiceKey}
      parseInput={parseInput}
      confirmOnSpace={confirmOnSpace}
      removeOnClick={removeOnClick}
    />
  );
}
