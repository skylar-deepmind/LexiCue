import { Fragment, memo, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecallMatch } from '../lib/recallMatcher';
import type { Segment } from '../lib/types';
import type { ReaderToken } from '../stores/readerStore';

type Range = { start: number; end: number };
type KeyRange = { segment: number; anchor: number; edge: number };
export interface TokenActions {
    pointerSelection: RefObject<boolean>;
    keyRange: RefObject<KeyRange | null>;
    choose: (segment: Segment, start: number, end: number) => void;
    setKeyboardRange: (selection: { segment: number } & Range) => void;
    pauseForSelection: () => void;
}

// Recall can change one sentence without rebuilding every other word button.
export default memo(function ReadingSentenceTokens({ segment, spans, matches, selection, keyboardSelection, actions }: {
    segment: Segment;
    spans: readonly ReaderToken[];
    matches: readonly RecallMatch[];
    selection?: Range;
    keyboardSelection?: Range;
    actions: RefObject<TokenActions | null>;
}) {
    const { t } = useTranslation();
    const pieces: ReactNode[] = [];
    let group: { match: RecallMatch; pieces: ReactNode[] } | null = null;
    const flushGroup = () => {
        if (!group) return;
        pieces.push(<span className="reading-recall" key={`recall-${group.match.start}-${group.match.end}`} data-recall-start={group.match.start} data-recall-end={group.match.end}>{group.pieces}</span>);
        group = null;
    };
    const append = (piece: ReactNode, match?: RecallMatch) => {
        if (group?.match !== match) flushGroup();
        if (match && !group) group = { match, pieces: [] };
        (group?.pieces ?? pieces).push(piece);
    };
    // Decorate only characters inside the existing match. In particular,
    // trailing punctuation stays attached to its word without being painted.
    const gap = (start: number, end: number, match?: RecallMatch) => {
        if (start >= end) return '';
        const text = segment.en_text.slice(start, end);
        if (!match || start >= match.end || end <= match.start) return text;
        const from = Math.max(start, match.start), to = Math.min(end, match.end);
        return <Fragment key={`gap-${start}-${end}`}>{segment.en_text.slice(start, from)}<span className="reading-recall-ink reading-recall-gap">{segment.en_text.slice(from, to)}</span>{segment.en_text.slice(to, end)}</Fragment>;
    };
    const appendGap = (start: number, end: number) => {
        let cursor = start;
        for (const match of matches) {
            if (match.end <= cursor || match.start >= end) continue;
            const from = Math.max(cursor, match.start), to = Math.min(end, match.end);
            if (cursor < from) append(segment.en_text.slice(cursor, from));
            append(gap(from, to, match), match);
            cursor = to;
        }
        if (cursor < end) append(segment.en_text.slice(cursor, end));
    };
    let offset = 0;
    spans.forEach((token, index) => {
        appendGap(offset, token.start);
        const marked = matches.find(match => token.start >= match.start && token.end <= match.end);
        const selected = keyboardSelection ? index >= keyboardSelection.start && index <= keyboardSelection.end
            : selection && token.start >= selection.start && token.end <= selection.end;
        const punctuation = segment.en_text.slice(token.end, spans[index + 1]?.start ?? segment.en_text.length).match(/^[,.;:!?…’”"')\]]+/)?.[0] ?? '';
        const text = segment.en_text.slice(token.start, token.end);
        const label = marked ? t('recall.marked', { expression: marked.expression }) : undefined;
        append(<span key={`${token.start}-${token.end}`} className="reading-token">
            <button className={`reading-word${marked ? ' reading-word--recalled' : ''}`}
                data-word-index={index} data-recall={marked?.expression} title={label} aria-description={label}
                aria-pressed={!!selected}
                onClick={event => {
                    const action = actions.current;
                    if (!action) return;
                    if (action.pointerSelection.current && event.detail !== 0) {
                        action.pointerSelection.current = false;
                        return;
                    }
                    if (event.detail === 0 || !window.getSelection()?.toString().trim()) {
                        event.currentTarget.focus({ preventScroll: true });
                        action.choose(segment, marked?.start ?? token.start, marked?.end ?? token.end);
                    }
                }}
                onKeyDown={event => {
                    const action = actions.current;
                    if (!action || !event.shiftKey || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
                    event.preventDefault();
                    action.pauseForSelection();
                    const previous = action.keyRange.current;
                    const range = previous?.segment === segment.id ? previous : { segment: segment.id, anchor: index, edge: index };
                    range.edge = Math.max(0, Math.min(spans.length - 1, range.edge + (event.key === 'ArrowRight' ? 1 : -1)));
                    action.keyRange.current = range;
                    action.setKeyboardRange({ segment: segment.id, start: Math.min(range.anchor, range.edge), end: Math.max(range.anchor, range.edge) });
                }}
                onKeyUp={event => {
                    const action = actions.current;
                    const range = action?.keyRange.current;
                    if (!action || !range || event.key !== 'Shift') return;
                    action.keyRange.current = null;
                    action.choose(segment, spans[Math.min(range.anchor, range.edge)].start, spans[Math.max(range.anchor, range.edge)].end);
                }}>{marked ? <span className="reading-recall-ink">{text}</span> : text}</button>
            {gap(token.end, token.end + punctuation.length, marked)}
        </span>, marked);
        offset = token.end + punctuation.length;
    });
    appendGap(offset, segment.en_text.length);
    flushGroup();
    return pieces;
});
