import { isField } from "./fields";

/**
 * One piece of the typed query: `tag:foo` is `{ key: "tag", value: "foo" }`, a plain word has no
 * key. `negated` when it had a `!` in front (`!tag:foo`, `!dune`, `!"two words"`).
 */
export type Token = { key: string | null; value: string; negated: boolean };

export const KEY = /^([A-Za-z]+):/;
export const isQuote = (c?: string) => c === "'" || c === '"';

// Reads a quoted run starting at s[i]. A quote only *closes* when followed by
// whitespace or end of input, so apostrophes inside ("Ender's Game") survive.
// Unterminated quotes take the rest of the string, so half-typed input works.
export function readQuoted(s: string, i: number): [string, number] {
  const q = s[i];
  let j = i + 1;
  let out = "";
  while (j < s.length) {
    if (s[j] === q && (j + 1 === s.length || /\s/.test(s[j + 1]))) {
      return [out, j + 1];
    }
    out += s[j++];
  }
  return [out, j];
}

// "tag:foo" -> {tag, foo}. Unknown prefixes ("10:30", "https:...") stay free text.
function toToken(s: string, negated: boolean): Token {
  const m = KEY.exec(s);
  const key = m?.[1].toLowerCase();
  if (m && key && isField(key)) {
    return { key, value: s.slice(m[0].length).trim(), negated };
  }
  return { key: null, value: s.trim(), negated };
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // A ! right before a token negates it. Only there: inside a quoted run, or after the first
    // character of a word, it is just a character ('!important', "Hello!"). A ! on its own says
    // nothing.
    let negated = false;
    if (input[i] === "!") {
      negated = true;
      i++;
      if (i >= input.length || /\s/.test(input[i])) continue;
    }

    // 'tag:name with spaces'  or  'just some quoted text'
    if (isQuote(input[i])) {
      const [inner, next] = readQuoted(input, i);
      tokens.push(toToken(inner, negated));
      i = next;
      continue;
    }

    // bare word, or key:'quoted value'
    let end = i;
    while (end < input.length && !/\s/.test(input[end])) end++;
    const word = input.slice(i, end);
    const m = KEY.exec(word);
    const key = m?.[1].toLowerCase();

    if (m && key && isField(key) && isQuote(input[i + m[0].length])) {
      const [value, next] = readQuoted(input, i + m[0].length);
      tokens.push({ key, value: value.trim(), negated });
      i = next;
    } else {
      tokens.push(toToken(word, negated));
      i = end;
    }
  }

  return tokens;
}
