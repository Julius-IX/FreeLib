import type { Choice, DraftRef } from "./types";

export const choiceKey = (c: Choice) => c.id ?? `new:${c.name.toLowerCase()}`;
/** A typed name -> a new draft. `normalize` is for fields with a canonical form (tags: lower-case). */
export const toDraft = (text: string, normalize: (name: string) => string = (n) => n): Choice | null => {
  const name = normalize(text.trim());
  return name ? { id: null, name } : null;
};

export const toChoice = (r: DraftRef): Choice => ({ id: r.id ?? null, name: r.name.trim() });
export const toChoices = (refs: DraftRef[] | undefined): Choice[] => {
  const seen = new Set<string | number>();
  return (refs ?? [])
    .map(toChoice)
    .filter((c) => c.name !== "" && !seen.has(choiceKey(c)) && !!seen.add(choiceKey(c)));
};
