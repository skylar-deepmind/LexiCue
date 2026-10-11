import { highlightOccurrence } from '../lib/occurrenceHighlight';
import { englishTokenSpans } from '../lib/englishTokenSpans';
import type { ReactNode } from 'react';
import type { Language } from '../lib/languages';

interface OccurrenceTextProps {
  text: string;
  surface: string;
  language: Language;
  mode?: 'word' | 'phrase';
  highlightClassName?: string;
  tokenPositions?: number[] | null;
}

export default function OccurrenceText({
  text,
  surface,
  language,
  mode = 'word',
  highlightClassName = 'rounded-sm bg-blue-50/60 font-medium text-blue-700',
  tokenPositions,
}: OccurrenceTextProps) {
  if (language === 'en' && mode === 'phrase' && tokenPositions?.length) {
    const selected = new Set(tokenPositions);
    const pieces: ReactNode[] = [];
    let offset = 0;
    for (const span of englishTokenSpans(text)) {
      if (span.start > offset) pieces.push(text.slice(offset, span.start));
      const part = text.slice(span.start, span.end);
      pieces.push(selected.has(span.position) ? <span key={span.position} className={highlightClassName}>{part}</span> : part);
      offset = span.end;
    }
    if (offset < text.length) pieces.push(text.slice(offset));
    return <>{pieces}</>;
  }
  const pieces = highlightOccurrence(text, surface, language, mode);
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={index} className={piece.highlighted ? highlightClassName : undefined}>
          {piece.text}
        </span>
      ))}
    </>
  );
}
