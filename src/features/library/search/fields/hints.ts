import type { ValueHint } from "./types";

// Shared by the keys that take a comparison. Strict `>` and `<` are not offered for dates, the
// backend ignores them there.

export const NUMBER_HINTS: ValueHint[] = [
  { value: ">", help: "more than" },
  { value: ">=", help: "this or more" },
  { value: "<", help: "less than" },
  { value: "<=", help: "this or less" },
  { value: "..", help: "up to, as in ..300" },
];

export const DATE_HINTS: ValueHint[] = [
  { value: ">=", help: "this or later" },
  { value: "<=", help: "this or earlier" },
  { value: "..", help: "until, as in ..2000" },
];
