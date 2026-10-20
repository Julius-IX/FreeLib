import type { ReadStatus } from "@/lib/types";
import type { FieldDef } from "./types";

const STATUS: Record<string, ReadStatus> = {
  unread: "unread",
  inprogress: "inProgress",
  reading: "inProgress",
  finished: "finished",
  read: "finished",
  done: "finished",
};

export const statusFields: FieldDef[] = [
  {
    keys: ["status"],
    help: "status:unread | reading | finished",
    set: (f, v) => {
      f.readStatus = STATUS[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
    },
  },
];
