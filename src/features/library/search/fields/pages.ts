import { parseRange, toInt } from "../values";
import { NUMBER_HINTS } from "./hints";
import type { FieldDef, Setter } from "./types";

/** pages:300  pages:>300  pages:>=300  pages:<300  pages:100..300  pages:300..  pages:..300 */
const setPages: Setter = (f, v) => {
  const single = /^(>=|<=|>|<|=)?\s*(\d+)$/.exec(v.trim());
  if (single) {
    const n = toInt(single[2]);
    if (n === undefined) return;
    switch (single[1] ?? "=") {
      case ">": f.pageCountMin = n + 1; break;
      case ">=": f.pageCountMin = n; break;
      case "<": f.pageCountMax = n - 1; break;
      case "<=": f.pageCountMax = n; break;
      default: f.pageCountMin = n; f.pageCountMax = n;
    }
    return;
  }
  const r = parseRange(v);
  if (!r) return;
  const min = r[0] === null ? null : (toInt(r[0]) ?? NaN);
  const max = r[1] === null ? null : (toInt(r[1]) ?? NaN);
  if (Number.isNaN(min) || Number.isNaN(max)) return; // "pages:10..abc": ignore it all
  f.pageCountMin = min;
  f.pageCountMax = max;
};

export const pageFields: FieldDef[] = [
  {
    keys: ["pages", "pagecount"],
    help: "pages:300 | >300 | >=300 | <300 | <=300 | 100..300 | 300.. | ..300",
    suggest: { summary: "page count", values: NUMBER_HINTS },
    set: setPages,
  },
];
