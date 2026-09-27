const STRIPPED = new Set('.,!?;:()[]{}"\'`«»–—…@#$%^&*+=<>/\\|~');

export interface EnglishTokenSpan {
  start: number;
  end: number;
  position: number;
}

// Mirrors the positions produced by tokenize_english_text in the Rust reader.
export function englishTokenSpans(text: string): EnglishTokenSpan[] {
  const spans: EnglishTokenSpan[] = [];
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    const delimiter = index === text.length || /\s/.test(char) || STRIPPED.has(char)
      || (char === '-' && (text[index + 1] === '-' || text[index - 1] === '-'));
    if (delimiter && start >= 0) {
      spans.push({ start, end: index, position: spans.length });
      start = -1;
    } else if (!delimiter && start < 0) {
      start = index;
    }
  }
  return spans;
}
