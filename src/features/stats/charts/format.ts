import { alpha, type Theme } from "@mui/material/styles";
import type { StatsMeasure } from "@/lib/types";
import { RATING_MAX } from "@/features/library/rating";

const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const formatValue = (measure: StatsMeasure, value: number) =>
  (measure === "avgRating" ? twoDecimals : whole).format(value);

/** Short form for axis ticks, where 12000 would crowd its neighbour. */
export const formatTick = (value: number) => compact.format(value);

/** Where the axis stops. A rating average is read against the whole scale, not the best bar. */
export const axisMax = (measure: StatsMeasure, values: number[]) =>
  measure === "avgRating" ? RATING_MAX : Math.max(0, ...values);

/** About `target` evenly spaced values from 0 up to or just past `max`. Counts never get a
 * fractional step, "0.5 books" is not a tick anyone wants. */
export function niceTicks(max: number, whole = false, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  if (whole) step = Math.max(1, Math.ceil(step));
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Colours for slices and series. Past the theme's own colours they repeat, a shade lighter. */
export function seriesColor(theme: Theme, index: number): string {
  const { primary, secondary, success, warning, error, info } = theme.palette;
  const base = [primary, secondary, success, warning, error, info].map((c) => c.main);
  const color = base[index % base.length];
  return index < base.length ? color : alpha(color, 0.6);
}
