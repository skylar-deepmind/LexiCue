import type { ReactElement } from 'react';
import type { Segment } from '../lib/types';
import type { SegmentPhrase, SegmentToken } from '../stores/readerStore';
import type { ReadingFontSize, ReadingLineHeight } from '../stores/preferencesStore';

const FONT_CLASS: Record<ReadingFontSize, string> = { sm: 'text-sm', md: 'text-base', lg: 'text-lg' };
const LINE_CLASS: Record<ReadingLineHeight, string> = { compact: 'leading-snug', normal: 'leading-relaxed', loose: 'leading-loose' };

interface WordInfo {
  id: number;
  lemma: string;
  status: string;
}

interface SegmentCardProps {
  segment: Segment;
  wordStatusMap: Map<string, WordInfo>;
  phrases?: SegmentPhrase[];
  segmentTokens?: SegmentToken[];
  onWordClick: (lemma: string, wordId: number | null) => void;
  onWordContextMenu: (lemma: string, wordId: number | null, x: number, y: number) => void;
  onPhraseClick?: (phraseId: number, text: string) => void;
  showTranslation?: boolean;
  highlightQuery?: string;
  isActive?: boolean;
  fontSize?: ReadingFontSize;
  lineHeight?: ReadingLineHeight;
}

interface RenderedToken {
  token: string;
  wordIndex: number;
  lemma: string | null;
}

function tokenizeEnText(text: string): RenderedToken[] {
  const raw = text.split(/(\s+)/).filter(Boolean);
  const result: RenderedToken[] = [];
  let wordIndex = 0;
  for (const token of raw) {
    if (/^\s+$/.test(token)) {
      result.push({ token, wordIndex: -1, lemma: null });
    } else {
      const clean = token.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
      const isWord = clean.length > 0 && (clean === 'a' || clean === 'i' || (clean.length > 1 && /^[a-z]+$/.test(clean)));
      result.push({ token, wordIndex: isWord ? wordIndex : -1, lemma: isWord ? clean : null });
      if (isWord) wordIndex++;
    }
  }
  return result;
}

function tokenizeSurfaceText(text: string, segTokens: SegmentToken[]): RenderedToken[] {
  const sorted = [...segTokens].sort((a, b) => a.position - b.position);
  const result: RenderedToken[] = [];
  let cursor = 0;
  let wordIndex = 0;
  for (const st of sorted) {
    const idx = text.indexOf(st.surface, cursor);
    if (idx > cursor) {
      result.push({ token: text.slice(cursor, idx), wordIndex: -1, lemma: null });
    }
    if (idx >= 0) {
      result.push({ token: st.surface, wordIndex, lemma: st.lemma });
      wordIndex++;
      cursor = idx + st.surface.length;
    }
  }
  if (cursor < text.length) {
    result.push({ token: text.slice(cursor), wordIndex: -1, lemma: null });
  }
  return result;
}

export default function SegmentCard({
  segment,
  wordStatusMap,
  phrases = [],
  segmentTokens,
  onWordClick,
  onWordContextMenu,
  onPhraseClick,
  showTranslation = true,
  highlightQuery = '',
  isActive = false,
  fontSize = 'md',
  lineHeight = 'normal',
}: SegmentCardProps) {
  const useSegmentTokens = segmentTokens !== undefined && segmentTokens.length > 0;
  const renderedTokens: RenderedToken[] =
    useSegmentTokens
      ? tokenizeSurfaceText(segment.en_text, segmentTokens)
      : tokenizeEnText(segment.en_text);

  const normalizedQuery = highlightQuery.trim().toLowerCase();

  const phraseByStartPos = new Map<number, SegmentPhrase>();
  for (const ph of phrases) {
    phraseByStartPos.set(ph.position, ph);
  }

  const phraseElements: ReactElement[] = [];
  let i = 0;
  while (i < renderedTokens.length) {
    const rt = renderedTokens[i];
    if (rt.wordIndex >= 0) {
      const phrase = phraseByStartPos.get(rt.wordIndex);
      if (phrase && onPhraseClick) {
        const phraseLen = phrase.word_count;
        const endIdx = findPhraseEnd(renderedTokens, i, rt.wordIndex, phraseLen);
        if (endIdx > i) {
          const phraseTokens = renderedTokens.slice(i, endIdx + 1).map(t => t.token).join('');
          phraseElements.push(
            <span
              key={i}
              onClick={() => onPhraseClick(phrase.phrase_id, phrase.text)}
              className={`cursor-pointer rounded-sm underline decoration-dotted ${
                phrase.status === 'learning'
                  ? 'text-purple-700 font-medium bg-purple-50/60'
                  : phrase.status === 'known'
                    ? 'text-purple-600'
                    : phrase.status === 'ignored'
                      ? 'text-gray-400 line-through decoration-gray-300'
                      : 'text-purple-500 hover:text-purple-700'
              }`}
            >
              {phraseTokens}
            </span>
          );
          i = endIdx + 1;
          continue;
        }
      }
    }

    if (rt.wordIndex >= 0 && rt.lemma !== null) {
      const lemma = rt.lemma;
      const info = wordStatusMap.get(lemma);
      phraseElements.push(
        <span
          key={i}
          onClick={() => onWordClick(lemma, info?.id ?? null)}
          onContextMenu={(e) => {
            e.preventDefault();
            onWordContextMenu(lemma, info?.id ?? null, e.clientX, e.clientY);
          }}
          className={`cursor-pointer rounded-sm hover:bg-blue-50 hover:underline decoration-dotted ${
            info?.status === 'learning'
              ? 'text-blue-700 font-medium bg-blue-50/60'
              : info?.status === 'known'
                ? 'text-green-700'
                : info?.status === 'ignored'
                  ? 'text-gray-400 line-through decoration-gray-300'
                  : info
                    ? 'text-gray-700'
                    : 'text-gray-400 hover:text-blue-500'
          } ${normalizedQuery && rt.token.toLowerCase().includes(normalizedQuery) ? 'bg-yellow-100 ring-1 ring-yellow-300' : ''}`}
        >
          {rt.token}
        </span>
      );
    } else {
      phraseElements.push(<span key={i}>{rt.token}</span>);
    }
    i++;
  }

  return (
    <div className={`bg-white rounded-lg border p-4 transition-colors ${
      isActive ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-200'
    }`}>
      <div className="flex items-start gap-3">
        {segment.start_time && (
          <span className="text-xs text-blue-500 font-mono bg-blue-50 px-2 py-0.5 rounded shrink-0 mt-0.5">
            {segment.start_time}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-gray-800 ${LINE_CLASS[lineHeight]} mb-1 ${FONT_CLASS[fontSize]}`}>
            {phraseElements}
          </p>
          {showTranslation && segment.zh_text && (
            <p className="text-gray-500 text-sm mt-2 border-t border-gray-100 pt-2">{segment.zh_text}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function findPhraseEnd(
  tokens: { token: string; wordIndex: number }[],
  start: number,
  startWordIndex: number,
  phraseLen: number,
): number {
  let found = 0;
  for (let j = start; j < tokens.length; j++) {
    if (tokens[j].wordIndex >= 0) {
      found++;
      if (found === phraseLen) return j;
    }
  }
  return start;
}
