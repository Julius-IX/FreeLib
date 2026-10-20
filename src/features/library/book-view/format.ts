import type { Reading } from "@/lib/types";

/** Today as YYYY-MM-DD in the user's local time (toISOString would give the UTC date). */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const parseDay = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** "2024-03-07" -> "Mar 7, 2024". Built from UTC parts so the day never shifts with the time zone. */
export const fmtDate = (s: string) => {
  const t = parseDay(s);
  return t === null
    ? s
    : new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};

export const readingRange = (r: Reading) => {
  if (r.dateStarted && r.dateFinished) return `${fmtDate(r.dateStarted)} – ${fmtDate(r.dateFinished)}`;
  if (r.dateStarted) return `Started ${fmtDate(r.dateStarted)}`;
  if (r.dateFinished) return `Finished ${fmtDate(r.dateFinished)}`;
  return "No dates";
};

export const readingDuration = (r: Reading): string | null => {
  if (!r.dateStarted || !r.dateFinished) return null;
  const a = parseDay(r.dateStarted);
  const b = parseDay(r.dateFinished);
  if (a === null || b === null || b < a) return null;
  const days = Math.round((b - a) / 86_400_000);
  return days === 0 ? "Same day" : `${days} ${days === 1 ? "day" : "days"}`;
};

/** A reading with no finish date is the one in progress. */
export const isOpen = (r: Reading) => r.dateFinished === null;

/** Newest first. Undated entries last. */
export const sortReadings = (readings: Reading[]) =>
  [...readings].sort((a, b) => (b.dateStarted ?? "").localeCompare(a.dateStarted ?? "") || b.readingId - a.readingId);
