/**
 * A rating is a number from 0 to 10; 0 means "not rated" (see `migrations/0003_rating.sql`).
 * It is drawn as `RATING_ICONS` icons, so every icon is worth 2 points, and can be tapped on its
 * left half (half an icon = 1 point) or its right half (the whole icon = 2 points). That makes
 * every whole number from 1 to 10 one tap away. Anything finer (7.5) is typed in, by tapping
 * the "7/10" label.
 */
export const RATING_MAX = 10;
export const RATING_ICONS = 5;

const POINTS_PER_ICON = RATING_MAX / RATING_ICONS;
/** The smallest jump a tap or an arrow key makes: half an icon. */
const STEP = POINTS_PER_ICON / 2;

/** Typed ratings are rounded to this many decimals, so 7.26 is saved as 7.3. */
const DECIMALS = 1;
const roundRating = (v: number) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

/** How much of icon number `index` (0-based) is filled for `value`: 0 (empty) to 1 (full). */
export function ratingFill(value: number, index: number): number {
  return Math.min(1, Math.max(0, value / POINTS_PER_ICON - index));
}

/**
 * The rating a tap at `x` px from the left edge of a row of icons `width` px wide stands for.
 * Every icon owns an equal slice of the width (its own gap included), so there are no dead
 * spots between icons.
 */
export function ratingAtPoint(x: number, width: number): number {
  if (width <= 0) return 0;
  const slice = width / RATING_ICONS;
  const clamped = Math.min(Math.max(x, 0), width - 1e-6);
  const index = Math.floor(clamped / slice);
  const leftHalf = clamped - index * slice < slice / 2;
  return index * POINTS_PER_ICON + (leftHalf ? STEP : POINTS_PER_ICON);
}

/** One arrow-key press: up to the next half icon, or down to the previous one. */
export function stepRating(value: number, direction: 1 | -1): number {
  const eps = 1e-9; // 7 / 1 is exactly 7, but 7.3 - 0.3 style values shouldn't skip a step
  const next =
    direction === 1
      ? (Math.floor(value / STEP + eps) + 1) * STEP
      : (Math.ceil(value / STEP - eps) - 1) * STEP;
  return Math.min(RATING_MAX, Math.max(0, next));
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: DECIMALS });

/** `7`, or `7.5` (`7,5` where that's the local way). Never a long float tail. */
export const formatRatingNumber = (value: number) => numberFormat.format(roundRating(value));

/** The label next to the icons: "7/10", or "–/10" when the book isn't rated. */
export const formatRating = (value: number) =>
  `${value > 0 ? formatRatingNumber(value) : "\u2013"}/${RATING_MAX}`;

const TYPED = new RegExp(String.raw`^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:/\s*${RATING_MAX})?$`);

/**
 * What the user typed, as a rating. Takes "7", "7.5", "7,5" (decimal comma) and "7.5/10".
 * `null` when it isn't a number from 0 to 10. 0 is valid, and means "not rated".
 */
export function parseRating(text: string): number | null {
  const m = TYPED.exec(text.trim());
  if (!m) return null;
  const value = roundRating(Number(m[1].replace(",", ".")));
  return value >= 0 && value <= RATING_MAX ? value : null;
}
