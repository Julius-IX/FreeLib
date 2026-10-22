import type { ReadStatus } from "@/lib/types";
import type { FieldDef, ValueHint } from "./types";

const STATUS: Record<string, ReadStatus> = {
  unread: "unread",
  inprogress: "inProgress",
  reading: "inProgress",
  finished: "finished",
  read: "finished",
  done: "finished",
};

// The main spellings of the map above. The punctuation-insensitive forms ("in-progress") work but
// are not worth listing.
const HINTS: ValueHint[] = [
  { value: "unread", help: "never started" },
  { value: "reading", aliases: ["inprogress"], help: "a reading still open" },
  { value: "finished", aliases: ["read", "done"], help: "at least one finished reading" },
];

export const statusFields: FieldDef[] = [
  {
    keys: ["status"],
    help: "status:unread | reading | finished",
    suggest: { summary: "reading progress", values: HINTS, expand: true },
    set: (f, v) => {
      f.readStatus = STATUS[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
    },
  },
];
