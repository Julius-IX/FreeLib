import { useSetting } from "@/lib/settings";

/**
 * How a category chip is drawn (book view, book form, "Update filter fields"). The cards in the
 * library grid ignore it: they only ever show small colour bars.
 *
 *   filled  the whole chip is the category's colour
 *   dot     a circle with the colour on the left, the rest of the chip is neutral
 *   square  same, but a rounded square
 *   bar     a long pill with the colour across the top of the chip
 */
export type CategoryStyle = "filled" | "dot" | "square" | "bar";

export const CATEGORY_STYLES: { value: CategoryStyle; label: string }[] = [
  { value: "filled", label: "Filled" },
  { value: "dot", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "bar", label: "Top bar" },
];

const isCategoryStyle = (v: unknown): v is CategoryStyle => CATEGORY_STYLES.some((s) => s.value === v);

/** Saved in settings.json under `categoryStyle` (also listed in `KNOWN` in settings.rs). */
export const useCategoryStyle = () => useSetting<CategoryStyle>("categoryStyle", "filled", isCategoryStyle);

/** Black or white, whichever is easier to read on `color` (`#rrggbb`, `#rgb` or `rgb()` / `rgba()`). */
export function readableOn(color: string): string {
  let r = 0, g = 0, b = 0;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = parseInt(h, 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = color.match(/[\d.]+/g);
    if (!m || m.length < 3) return "#fff";
    [r, g, b] = m.slice(0, 3).map(Number);
  }
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.4 ? "#000" : "#fff";
}
