export interface EnglishTokenSpan {
  start: number;
  end: number;
  position: number;
}

// Mirrors the positions produced by tokenize_english_text in the Rust reader.
export function englishTokenSpans(text: string): EnglishTokenSpan[] {
  const spans: EnglishTokenSpan[] = [];
  const tokens = [...text.matchAll(/\S+/g)];
  for (const [position, match] of tokens.entries()) {
    const raw = match[0];
    const lower = raw.toLowerCase();
    if (/^(https?:\/\/|www\.)/.test(lower) || (lower.includes('@') && lower.includes('.')) || /\.(png|jpe?g|gif|webp|svg|mp3|mp4|srt|txt|html)[\W]*$/.test(lower) || raw.includes('-')) continue;
    const leading = raw.match(/^[^A-Za-z]+/)?.[0].length ?? 0;
    const trailing = raw.match(/[^A-Za-z'’‘]+$/)?.[0].length ?? 0;
    const start = (match.index ?? 0) + leading;
    const end = (match.index ?? 0) + raw.length - trailing;
    const normalized = text.slice(start, end).replace(/[’‘]/g, "'");
    if (!/[A-Za-z]/.test(normalized)) continue;
    spans.push({ start, end, position });
  }
  return spans;
}
