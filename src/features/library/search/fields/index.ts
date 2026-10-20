import { dateFields } from "./dates";
import { idFields } from "./ids";
import { pageFields } from "./pages";
import { statusFields } from "./status";
import { textFields } from "./text";
import type { FieldDef, Setter } from "./types";

/**
 * Every key the search box understands. To add a group, make a file next to this one that exports
 * a `FieldDef[]` and add it here.
 */
export const FIELDS: FieldDef[] = [
  ...textFields,
  ...statusFields,
  ...dateFields,
  ...pageFields,
  ...idFields,
];

const BY_KEY = new Map<string, Setter>();
for (const def of FIELDS) {
  for (const key of def.keys) {
    if (!/^[a-z]+$/.test(key)) throw new Error(`search key "${key}" must be lower-case letters only`);
    if (BY_KEY.has(key)) throw new Error(`search key "${key}" is defined twice`);
    BY_KEY.set(key, def.set);
  }
}

export const isField = (key: string): boolean => BY_KEY.has(key);
export const fieldSetter = (key: string): Setter | undefined => BY_KEY.get(key);
