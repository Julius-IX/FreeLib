import { isNumber, useSetting } from "@/lib/settings";
import { isMobile } from "@/util/misc";

/** How many book covers fit across the library grid (the "scale" of the library). */
export const libraryColumnsRange = () =>
  isMobile() ? { min: 1, max: 5, fallback: 3 } : { min: 1, max: 10, fallback: 6 };

export function useLibraryColumns() {
  const { min, max, fallback } = libraryColumnsRange();
  const [saved, save] = useSetting<number>(
    "libraryColumns",
    fallback,
    (v): v is number => isNumber(v) && Number.isInteger(v) && v >= min && v <= max,
  );
  return [saved, save] as const;
}
