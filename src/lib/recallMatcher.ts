/** Literal English re-encounter matching. Case and Unicode whitespace are the
 * only equivalences: no lemmas, punctuation removal or inferred meanings. */
export interface RecallMatch { start: number; end: number; expression: string }
export interface RecallSegment { index: number; text: string }
interface Node { next: Map<string, Node>; expressions?: string[] }
const word = /[\p{L}\p{M}\p{N}_]/u;
const whitespace = /\p{White_Space}/u;
const connector = /['’\-‐‑]/u;
export function normalizeRecall(expression: string): string {
  return expression.split(/\p{White_Space}+/u).filter(Boolean).join(' ').toLowerCase();
}
const surface = (expression: string) => expression.split(/\p{White_Space}+/u).filter(Boolean).join(' ');
const allCaps = (expression: string) => {
  const letters = [...expression].filter(character => /\p{Alphabetic}/u.test(character));
  return letters.length > 1 && letters.every(character => character === character.toUpperCase() && character !== character.toLowerCase());
};
// The native index preserves case only when dictionary/history evidence requires
// it. The pronoun I and its contractions retain the earlier literal behavior.
const caseSensitive = (expression: string) => allCaps(expression) || expression !== expression.toLowerCase() && !/^I(?:['’]|$)/u.test(expression);
const noCaseExclusions: ReadonlySet<string> = new Set();
export function recallExpression(expressions: readonly string[], expression: string, caseExclusions: ReadonlySet<string> = noCaseExclusions, literalOnly = false): string | undefined {
  const exact = surface(expression), normalized = normalizeRecall(expression);
  const reserved = expressions.find(item => surface(item) === exact);
  if (reserved) return reserved;
  if (literalOnly) return undefined;
  // Source-reserved spellings require a literal live saved identity. A lone
  // lowercase us/may must not decorate US/May via the case-folded trie.
  if (allCaps(exact) || caseExclusions.has(exact)) return undefined;
  return expressions.find(item => !caseSensitive(item) && !caseExclusions.has(surface(item)) && normalizeRecall(item) === normalized);
}
function normalizeText(text: string) {
  let value = '', offset = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const character of text) {
    const end = offset + character.length;
    if (whitespace.test(character)) {
      if (value.endsWith(' ')) ends[ends.length - 1] = end;
      else { value += ' '; starts.push(offset); ends.push(end); }
    } else {
      const lower = character.toLowerCase(); value += lower;
      for (let i = 0; i < lower.length; i++) { starts.push(offset); ends.push(end); }
    }
    offset = end;
  }
  return { value, starts, ends };
}
// Apostrophes and hyphens join words only when they have word characters on
// both sides. Quotation marks around an expression remain valid boundaries.
function boundary(text: string, position: number): boolean {
  const before = text[position - 1] ?? '', after = text[position] ?? '';
  if (word.test(before) && word.test(after)) return false;
  if (connector.test(before) && word.test(text[position - 2] ?? '') && word.test(after)) return false;
  if (connector.test(after) && word.test(before) && word.test(text[position + 1] ?? '')) return false;
  return true;
}
export function compileRecall(expressions: readonly string[], exclusions: readonly string[] = [], literalOnly = false) {
  const root: Node = { next: new Map() };
  const caseExclusions = new Set(exclusions.map(surface));
  for (const raw of expressions) {
    const expression = normalizeRecall(raw);
    if (!/[A-Za-z]/.test(expression) || [...expression].some(c => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c))) continue;
    let node = root;
    // UTF-16 keys deliberately match browser selection offsets, including emoji.
    for (let i = 0; i < expression.length; i++) {
      const character = expression[i];
      if (!node.next.has(character)) node.next.set(character, { next: new Map() });
      node = node.next.get(character)!;
    }
    const identity = literalOnly || caseSensitive(raw) || caseExclusions.has(surface(raw)) ? surface(raw) : expression;
    node.expressions ??= [];
    if (!node.expressions.includes(identity)) node.expressions.push(identity);
  }
  return {
    match(text: string): RecallMatch[] {
      const { value, starts, ends } = normalizeText(text);
      const matches: RecallMatch[] = [];
      for (let start = 0; start < value.length; start++) {
        if (!boundary(value, start)) continue;
        let node = root, best: { end: number; expression: string } | undefined;
        for (let end = start; end < value.length; end++) {
          const next = node.next.get(value[end]); if (!next) break; node = next;
          if (node.expressions && boundary(value, end + 1)) {
            const original = surface(text.slice(starts[start], ends[end]));
            const expression = recallExpression(node.expressions, original, caseExclusions, literalOnly);
            if (expression) best = { end, expression };
          }
        }
        if (best) {
          matches.push({ start: starts[start], end: ends[best.end], expression: best.expression });
          // Earliest position, longest expression wins overlapping decorations.
          start = best.end;
        }
      }
      return matches;
    },
  };
}
