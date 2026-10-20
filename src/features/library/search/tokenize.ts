import { isField } from "./fields";

/** One piece of the typed query: `tag:foo` is `{ key: "tag", value: "foo" }`, a plain word has no key. */
export type Token = { key: string | null; value: string };

const KEY = /^([A-Za-z]+):/;
const isQuote = (c?: string) => c === "'" || c === '"';

// Reads a quoted run starting at s[i]. A quote only *closes* when followed by
// whitespace or end of input, so apostrophes inside ("Ender's Game") survive.
// Unterminated quotes take the rest of the string, so half-typed input works.
function readQuoted(s: string, i: number): [string, number] {
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
function toToken(s: string): Token {
  const m = KEY.exec(s);
  const key = m?.[1].toLowerCase();
  if (m && key && isField(key)) {
    return { key, value: s.slice(m[0].length).trim() };
  }
  return { key: null, value: s.trim() };
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // 'tag:name with spaces'  or  'just some quoted text'
    if (isQuote(input[i])) {
      const [inner, next] = readQuoted(input, i);
      tokens.push(toToken(inner));
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
      tokens.push({ key, value: value.trim() });
      i = next;
    } else {
      tokens.push(toToken(word));
      i = end;
    }
  }

  return tokens;
}
