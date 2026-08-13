import { highlightOccurrence } from '../lib/occurrenceHighlight';
import type { Language } from '../lib/languages';

interface OccurrenceTextProps {
  text: string;
  surface: string;
  language: Language;
  mode?: 'word' | 'phrase';
  highlightClassName?: string;
}

export default function OccurrenceText({
  text,
  surface,
  language,
  mode = 'word',
  highlightClassName = 'rounded-sm bg-blue-50/60 font-medium text-blue-700',
}: OccurrenceTextProps) {
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
