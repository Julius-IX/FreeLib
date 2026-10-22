import type { BookFilter } from "@/lib/types";
import { parseRange } from "../values";
import { DATE_HINTS } from "./hints";
import type { FieldDef, Setter, Suggest } from "./types";

// Dates are sent to the backend as typed ("2024", "2024-03", "March 2024", ...).
// It expands partial dates to whole periods and ignores anything half-typed.

const dates =
  (set: (f: BookFilter, from: string | null, to: string | null) => void): Setter =>
    (f, v) => {
      const r = parseRange(v);
      if (r) set(f, r[0], r[1]);
    };

const suggest = (summary: string): Suggest => ({ summary, values: DATE_HINTS });

const RANGES = "2024 | 2024-03 | 2024-03-07 | \"March 2024\" | 1990..2000 | 1990.. | ..2000 | >=1990 | <=2000";

export const dateFields: FieldDef[] = [
  {
    keys: ["published", "pub", "year"],
    help: `published:${RANGES}`,
    suggest: suggest("publish date"),
    set: dates((f, a, b) => { f.publishFrom = a; f.publishTo = b; }),
  },
  {
    keys: ["born"],
    help: "born:1920  an author's birth date, same forms as published:",
    suggest: suggest("an author's birth date"),
    set: dates((f, a, b) => { f.authorBirthFrom = a; f.authorBirthTo = b; }),
  },
  {
    keys: ["died"],
    help: "died:..1990  an author's death date, same forms as published:",
    suggest: suggest("an author's death date"),
    set: dates((f, a, b) => { f.authorDeathFrom = a; f.authorDeathTo = b; }),
  },
  {
    keys: ["started"],
    help: "started:2024  when a reading was started, same forms as published:",
    suggest: suggest("when a reading was started"),
    set: dates((f, a, b) => { f.startedFrom = a; f.startedTo = b; }),
  },
  {
    keys: ["finished"],
    help: "finished:2024-03  when a reading was finished, same forms as published:",
    suggest: suggest("when a reading was finished"),
    set: dates((f, a, b) => { f.finishedFrom = a; f.finishedTo = b; }),
  },
];
