import type { Choice, DraftRef } from "./types";

export const choiceKey = (c: Choice) => c.id ?? `new:${c.name.toLowerCase()}`;
export const toDraft = (text: string): Choice | null => {
  const name = text.trim();
  return name ? { id: null, name } : null;
};

export const toChoice = (r: DraftRef): Choice => ({ id: r.id ?? null, name: r.name.trim() });
export const toChoices = (refs: DraftRef[] | undefined): Choice[] => {
  const seen = new Set<string | number>();
  return (refs ?? [])
    .map(toChoice)
    .filter((c) => c.name !== "" && !seen.has(choiceKey(c)) && !!seen.add(choiceKey(c)));
};
