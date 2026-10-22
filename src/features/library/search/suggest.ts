import { FIELDS, isField } from "./fields";
import type { FieldDef } from "./fields/types";
import { KEY, isQuote, readQuoted } from "./tokenize";

/** One entry of the suggestions list. `text` replaces the whole token being typed. */
export type Suggestion = { text: string; summary: string };

export type Suggestions = {
  items: Suggestion[];
  /** The part of the input that `text` replaces. */
  from: number;
  to: number;
};

const BY_KEY = new Map<string, FieldDef>(FIELDS.flatMap((def) => def.keys.map((k): [string, FieldDef] => [k, def])));

/**
 * The names that fit what has been typed so far. A main spelling wins over its aliases, so `p` does
 * not list `pub` and `pagecount` next to `published` and `pages`. An alias only shows up when it is
 * the only way to reach the entry (`y` finds `year`).
 */
function matching(names: string[], typed: string): string[] {
  const [main, ...aliases] = names;
  return main.startsWith(typed) ? [main] : aliases.filter((a) => a.startsWith(typed));
}

/**
 * Where the token that ends at `caret` starts and ends, or null when the caret is not on one.
 * Follows the tokenizer's quote rules, so a space inside `author:'Le Guin'` does not start a new
 * token. The text inside a quoted value is never suggested for.
 */
function tokenAt(input: string, caret: number): { start: number; end: number } | null {
  let i = 0;
  while (i < caret) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    const start = i;
    if (input[i] === "!") i++;

    const key = KEY.exec(input.slice(i))?.[0];
    const quoteAt = key && isField(key.slice(0, -1).toLowerCase()) ? i + key.length : i;
    if (isQuote(input[quoteAt])) {
      const [, next] = readQuoted(input, quoteAt);
      if (next >= caret) return null; // caret is inside the quotes or right behind them
      i = next;
      continue;
    }

    let end = i;
    while (end < input.length && !/\s/.test(input[end])) end++;
    if (end >= caret) return { start, end };
    i = end;
  }
  return null;
}

function keySuggestions(prefix: string, typed: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const def of FIELDS) {
    const { summary, values, expand } = def.suggest ?? {};
    if (!summary) continue;
    for (const name of matching(def.keys, typed)) {
      if (expand && values) {
        out.push(...values.map((v) => ({ text: `${prefix}${name}:${v.value}`, summary: v.help })));
      } else {
        out.push({ text: `${prefix}${name}:`, summary });
      }
    }
  }
  return out;
}

function valueSuggestions(head: string, def: FieldDef, value: string): Suggestion[] {
  const { values, multi } = def.suggest ?? {};
  if (!values) return [];

  // "cover,i" -> items already listed are "cover", the one being typed is "i"
  const cut = multi ? value.lastIndexOf(",") + 1 : 0;
  const typed = value.slice(cut).toLowerCase();
  const listed = new Set(value.slice(0, cut).toLowerCase().split(","));

  const out: Suggestion[] = [];
  for (const v of values) {
    const names = [v.value, ...(v.aliases ?? [])];
    if (names.some((n) => listed.has(n))) continue;
    for (const name of matching(names, typed)) {
      if (name === typed) continue; // already complete
      out.push({ text: `${head}${value.slice(0, cut)}${name}`, summary: v.help });
    }
  }
  return out;
}

/**
 * The syntax that can follow what is being typed at `caret`: keys while a word is typed, the
 * values of a key once its colon is there. Null when there is nothing to show.
 *
 * This only lists what the query language accepts, it never completes the user's own text (tags,
 * authors and so on stay as typed). The list comes from the `suggest` of each field definition, so
 * a new key only has to describe itself there.
 */
export function suggest(input: string, caret: number): Suggestions | null {
  const at = tokenAt(input, caret);
  if (!at) return null;

  const fragment = input.slice(at.start, caret);
  const negated = fragment.startsWith("!");
  const prefix = negated ? "!" : "";
  const body = fragment.slice(prefix.length);
  if (!body) return null;

  const colon = body.indexOf(":");
  let items: Suggestion[];
  if (colon < 0) {
    items = keySuggestions(prefix, body.toLowerCase());
  } else {
    const def = BY_KEY.get(body.slice(0, colon).toLowerCase());
    items = def ? valueSuggestions(prefix + body.slice(0, colon + 1), def, body.slice(colon + 1)) : [];
  }
  return items.length ? { items, from: at.start, to: at.end } : null;
}
