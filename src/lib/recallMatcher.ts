/** Literal English re-encounter matching. Case and Unicode whitespace are the
 * only equivalences: no lemmas, punctuation removal or inferred meanings. */
export interface RecallMatch { start: number; end: number; expression: string }
export interface RecallSegment { index: number; text: string }
interface Node { next: Map<string, Node>; expression?: string }
const word = /[\p{L}\p{M}\p{N}_]/u;
const whitespace = /\p{White_Space}/u;
const connector = /['’\-‐‑]/u;
export function normalizeRecall(expression: string): string {
  return expression.split(/\p{White_Space}+/u).filter(Boolean).join(' ').toLowerCase();
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
export function compileRecall(expressions: readonly string[]) {
  const root: Node = { next: new Map() };
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
    node.expression = expression;
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
          if (node.expression && boundary(value, end + 1)) best = { end, expression: node.expression };
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
