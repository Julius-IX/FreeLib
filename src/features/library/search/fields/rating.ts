import { RATING_MAX } from "../../rating";
import { parseRange } from "../values";
import type { FieldDef, Setter } from "./types";

// A rating is 0-10 (the "7/10" next to the icons). A book with no rating isn't matched by any
// rating range, use `has:rating` for those. Decimals are fine, "7,5" too, and a trailing "/10".

const NUMBER = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;

/** "7", "7.5", "7,5" or "7/10" -> the number, else undefined (also for anything over 10). */
function toRating(raw: string): number | undefined {
  const s = raw.trim().replace(new RegExp(String.raw`\s*/\s*${RATING_MAX}$`), "");
  if (!NUMBER.test(s)) return undefined;
  const n = Number(s.replace(",", "."));
  return n >= 0 && n <= RATING_MAX ? n : undefined;
}

/** rating:8  rating:>7  rating:>=7  rating:<5  rating:<=5  rating:5..8  rating:7..  rating:..5 */
const setRating: Setter = (f, v) => {
  const s = v.trim();

  if (s.includes("..")) {
    const r = parseRange(s);
    if (!r) return;
    const min = r[0] === null ? null : (toRating(r[0]) ?? NaN);
    const max = r[1] === null ? null : (toRating(r[1]) ?? NaN);
    if (Number.isNaN(min) || Number.isNaN(max)) return; // "rating:5..abc": ignore it all
    f.ratingMin = min;
    f.ratingMax = max;
    return;
  }

  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(s);
  const n = m ? toRating(m[2]) : undefined;
  if (!m || n === undefined) return;
  switch (m[1] ?? "=") {
    case ">": f.ratingMin = n; f.ratingMinExclusive = true; break;
    case ">=": f.ratingMin = n; break;
    case "<": f.ratingMax = n; f.ratingMaxExclusive = true; break;
    case "<=": f.ratingMax = n; break;
    default: f.ratingMin = n; f.ratingMax = n;
  }
};

export const ratingFields: FieldDef[] = [
  {
    keys: ["rating"],
    help: "rating:8 | >7 | >=7 | <5 | <=5 | 5..8 | 7.. | ..5   on the 0-10 scale, rated books only",
    set: setRating,
  },
];
