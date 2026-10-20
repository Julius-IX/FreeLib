import type { BookFilter } from "@/lib/types";
import { parseIds } from "../values";
import type { FieldDef, Setter } from "./types";

const idList =
  (set: (f: BookFilter, ids: number[]) => void): Setter =>
    (f, v) => {
      const ids = parseIds(v);
      if (ids) set(f, ids);
    };

/** Exact ids, for links and scripts rather than for typing: the ids are shown nowhere. */
export const idFields: FieldDef[] = [
  {
    keys: ["seriesid"],
    help: "seriesid:3  exactly this series",
    set: (f, v) => {
      const ids = parseIds(v);
      if (ids?.length === 1) f.seriesId = ids[0];
    },
  },
  { keys: ["authorid"], help: "authorid:1,2  any of these authors", set: idList((f, ids) => { f.authorIdsAny = ids; }) },
  { keys: ["tagid"], help: "tagid:4,5  any of these tags", set: idList((f, ids) => { f.tagIdsAny = ids; }) },
  { keys: ["tagall"], help: "tagall:4,5  every one of these tags", set: idList((f, ids) => { f.tagIdsAll = ids; }) },
  { keys: ["tagnone"], help: "tagnone:4,5  none of these tags", set: idList((f, ids) => { f.tagIdsNone = ids; }) },
  { keys: ["categoryid"], help: "categoryid:1,2  any of these categories", set: idList((f, ids) => { f.categoryIdsAny = ids; }) },
  { keys: ["categoryall"], help: "categoryall:1,2  every one of these categories", set: idList((f, ids) => { f.categoryIdsAll = ids; }) },
  { keys: ["categorynone"], help: "categorynone:1,2  none of these categories", set: idList((f, ids) => { f.categoryIdsNone = ids; }) },
];
