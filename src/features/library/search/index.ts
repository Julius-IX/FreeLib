/**
 * The search box's query language: `tag:fantasy author:'Le Guin' pages:>300 !has:cover dune`.
 *
 *   emptyFilter.ts   a filter that filters nothing
 *   tokenize.ts      splits the text into words and `key:value` pairs, with quotes and `!`
 *   parseQuery.ts    puts the tokens together into a filter (`!token` goes to its `exclude`)
 *   fields/          one definition per accepted key (new keys are added there)
 *   values.ts        helpers for reading values: ranges, id lists, integers
 *   suggest.ts       the syntax that can follow the text typed so far, for the suggestions list
 */
export { emptyFilter } from "./emptyFilter";
export { FIELDS } from "./fields";
export { parseQuery } from "./parseQuery";
export { suggest } from "./suggest";
export type { Suggestion, Suggestions } from "./suggest";
