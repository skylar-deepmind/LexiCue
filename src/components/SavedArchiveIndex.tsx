import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownAZ, ChartNoAxesColumnIncreasing } from 'lucide-react';
import type { SavedGroup, SavedGroupOrder } from '../lib/savedRecords';
import { BusyRing } from './LoadingFeedback';

export function SavedOrderSlider({ order, onChange }: { order: SavedGroupOrder; onChange: (order: SavedGroupOrder) => void }) {
  const { t } = useTranslation();
  const pointer = useRef<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const positionAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left - 25.5) / 43));
  };
  const stop = () => { pointer.current = null; setPosition(null); };
  const label = order === 'alphabet' ? t('savedRecords.sortAlphabet') : t('savedRecords.sortCount');

  return <div
    className="saved-order-slider" role="slider" tabIndex={0}
    aria-label={t('savedRecords.sort')} aria-valuemin={0} aria-valuemax={1}
    aria-valuenow={order === 'count' ? 1 : 0} aria-valuetext={label}
    data-order={order} data-dragging={position !== null}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPosition(positionAt(event));
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) setPosition(positionAt(event)); }}
    onPointerUp={event => {
      if (pointer.current !== event.pointerId) return;
      onChange(positionAt(event) >= 0.5 ? 'count' : 'alphabet');
      stop();
    }}
    onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const next = ['ArrowLeft', 'ArrowDown', 'Home'].includes(event.key) ? 'alphabet'
        : ['ArrowRight', 'ArrowUp', 'End'].includes(event.key) ? 'count'
        : event.key === ' ' || event.key === 'Enter' ? (order === 'count' ? 'alphabet' : 'count')
        : null;
      if (!next) return;
      event.preventDefault();
      onChange(next);
    }}
  >
    <span className="saved-order-track" aria-hidden="true">
      <span className="saved-order-thumb" style={position === null ? undefined : { transform: `translateX(${position * 43}px)` }}/>
      <ArrowDownAZ size={17} strokeWidth={1.65}/>
      <ChartNoAxesColumnIncreasing size={17} strokeWidth={1.65}/>
    </span>
  </div>;
}

type AlphabetSection = { letter: string; groups: SavedGroup[] };
function splitAlphabetically(groups: SavedGroup[]): AlphabetSection[] {
  const sections: AlphabetSection[] = [];
  for (const group of groups) {
    const initial = group.expression.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')[0]?.toUpperCase();
    const letter = initial && /^[A-Z]$/.test(initial) ? initial : '#';
    const previous = sections.at(-1);
    if (previous?.letter === letter) previous.groups.push(group);
    else sections.push({ letter, groups: [group] });
  }
  return sections;
}

export default function SavedArchiveIndex({
  groups, order, selected, loading, error, loadingMore, hasMore, query, listRef,
  onOrderChange, onChoose, onPreview, onMore, onRetry, onScroll,
}: {
  groups: SavedGroup[]; order: SavedGroupOrder; selected: string | null;
  loading: boolean; error: boolean; loadingMore: boolean; hasMore: boolean; query: string;
  listRef: RefObject<HTMLDivElement | null>;
  onOrderChange: (order: SavedGroupOrder) => void; onChoose: (group: SavedGroup) => void;
  onPreview: (group: SavedGroup) => void; onMore: () => void; onRetry: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const words = new Map(groups.map(group => [group.group_id, group]));
  const focusWord = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.approved-saved-word:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !buttons.length) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1)));
    const button = buttons[next];
    const group = words.get(button.dataset.group ?? '');
    if (!group) return;
    event.preventDefault();
    button.focus();
    onPreview(group);
  };

  const word = (group: SavedGroup) => <button
    key={group.group_id} type="button" className="approved-saved-word" data-group={group.group_id}
    aria-pressed={selected === group.group_id} disabled={loading} onClick={() => onChoose(group)}
  ><span lang="en">{group.expression}</span></button>;

  return <aside className="saved-directory" aria-label={t('savedRecords.directory')}>
    <SavedOrderSlider order={order} onChange={onOrderChange}/>
    <div ref={listRef} className="approved-saved-index" data-order={order} aria-busy={loading || loadingMore}
      onKeyDown={focusWord} onScroll={onScroll}>
      {order === 'alphabet' ? splitAlphabetically(groups).map((section, i) =>
        <div className="saved-letter-group" key={`${section.letter}:${i}`}>
          <div className="saved-letter" aria-hidden="true">{section.letter}</div>
          <div className="saved-word-list">{section.groups.map(word)}</div>
        </div>
      ) : groups.map(group => <div key={group.group_id} className="saved-ranked-row">
        <span className="saved-count-meter" role="img" aria-label={t('savedRecords.exampleCount', { count: group.context_count })}>
          {Array.from({ length: 6 }, (_, i) => <i key={i} data-filled={i < group.context_count}/>)}
        </span>
        {word(group)}
      </div>)}
      {loading && !groups.length && <div className="saved-archive-status" role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></div>}
      {error && <div className="saved-archive-status" role="alert">
        <p>{t('savedRecords.loadError')}</p><button type="button" className="saved-archive-action" onClick={onRetry}>{t('common.retry')}</button>
      </div>}
      {!loading && !error && !groups.length && <p className="approved-saved-empty">{t(query ? 'savedRecords.noResults' : 'savedRecords.empty')}</p>}
      {!error && hasMore && <button type="button" className="saved-archive-action" disabled={loading || loadingMore} onClick={onMore}>{t(loadingMore ? 'common.loading' : 'savedRecords.loadMore')}</button>}
    </div>
  </aside>;
}
