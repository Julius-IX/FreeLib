/** Helpers for reading the value part of a `key:value` token. Shared by the field definitions. */

const INT = /^\d+$/;
const OP = /^(>=|<=|>|<|=)\s*(.*)$/;

/** Non-negative integer that survives the trip to an i64, else undefined. */
export const toInt = (s: string): number | undefined =>
  INT.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined;

/**
 * "a..b", "a..", "..b", ">=a", "<=b", "=a" or a bare "a" -> [from, to].
 * A bare value is both bounds, so "2024" means "during 2024".
 * Strict ">" and "<" are not handled here (null).
 */
export function parseRange(v: string): [from: string | null, to: string | null] | null {
  const s = v.trim();
  const dots = s.indexOf("..");
  if (dots >= 0) {
    const a = s.slice(0, dots).trim();
    const b = s.slice(dots + 2).trim();
    return a || b ? [a || null, b || null] : null;
  }
  const m = OP.exec(s);
  if (m) {
    const x = m[2].trim();
    if (!x) return null;
    if (m[1] === ">=") return [x, null];
    if (m[1] === "<=") return [null, x];
    if (m[1] === "=") return [x, x];
    return null;
  }
  return s ? [s, s] : null;
}

/** "3,5 7" -> [3, 5, 7]. Any non-integer makes the whole value invalid (null). */
export function parseIds(v: string): number[] | null {
  const parts = v.split(/[,\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const n = toInt(p);
    if (n === undefined) return null;
    out.push(n);
  }
  return out.length ? out : null;
}
