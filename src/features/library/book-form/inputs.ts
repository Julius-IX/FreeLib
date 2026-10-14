export const emptyToNull = (s: string) => (s.trim() === "" ? null : s.trim());
export const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

// Hides the browser's up/down arrows on number inputs.
export const noSpinners = {
  "& input[type=number]": { MozAppearance: "textfield" },
  "& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
    { WebkitAppearance: "none", margin: 0 },
};

/**
 * "2024-03-07", "2024/3/7" or "2024.03.07" -> "2024-03-07".
 * Empty -> null. Anything else, or a date that doesn't exist -> undefined (invalid).
 */
export function normalizeDate(text: string): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Like `normalizeDate`, but also accepts a year or a month: "1892", "1892-3" -> "1892-03",
 * "1892/3/7" -> "1892-03-07". Empty -> null. Anything else -> undefined (invalid).
 * The filter treats a partial date as the whole period it names.
 */
export function normalizePartialDate(text: string): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}$/.test(t)) return t;
  const ym = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (ym) {
    const mo = Number(ym[2]);
    return mo >= 1 && mo <= 12 ? `${ym[1]}-${String(mo).padStart(2, "0")}` : undefined;
  }
  return normalizeDate(t);
}

/** True when a (possibly partial) birth date is after a (possibly partial) death date. */
export function startsAfter(birth: string, death: string): boolean {
  const first = birth + "0000-01-01".slice(birth.length); // earliest day it could mean
  const last = death + "9999-12-31".slice(death.length); // latest day it could mean
  return first > last;
}

export const normIsbn = (s: string) => s.replace(/[\s-]/g, "").toUpperCase(); // 978-0-... == 9780...

/**
 * Same rule as `normalize_isbn` in the Rust covers module: 13 digits, or 9 digits plus a digit
 * or X. No checksum. Anything the backend would reject is rejected here too, so a book can't
 * be saved with an ISBN its cover could never be stored under.
 */
export const isValidIsbn = (s: string) => /^(\d{13}|\d{9}[\dX])$/.test(normIsbn(s));
