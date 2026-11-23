import useTrashDrag from './useTrashDrag';
import { createViewCache } from '../lib/pageNavigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { savedErrorKey, type SavedRecord } from '../lib/savedRecords';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import SourceAudioControls from './SourceAudioControls';
import { bindMediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import useContentFontScaleStyle from './useContentFontScaleStyle';

interface Props {
  record: SavedRecord;
  active: boolean;
  onActivate: () => void;
  onRemove?: (record: SavedRecord) => Promise<void>;
  onSource?: (record: SavedRecord, isCurrent?: () => boolean) => Promise<void>;
  removing?: boolean;
  sourceBusy?: boolean;
}

const sentenceViews = createViewCache<boolean>(128);
export default function SavedSentence({ record, active, onActivate, onRemove, onSource, removing = false, sourceBusy = false }: Props) {
  const { t } = useTranslation();
  const fontScaleStyle = useContentFontScaleStyle();
  const media = record.source?.media;
  const mediaReady = useSourceMediaStore(state => !!media && state.entries[media.source.key]?.status === 'ready');
  const sourceIntent = useRef({ active, generation: 0 });
  if (sourceIntent.current.active !== active) { sourceIntent.current.active = active; sourceIntent.current.generation++; }
  useEffect(() => () => { sourceIntent.current.generation++; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceMissing, setSourceMissing] = useState(!record.source);
  const [expanded, setExpanded] = useState(sentenceViews.get(record.record_id) ?? false);
  useLayoutEffect(() => { sentenceViews.set(record.record_id, expanded); }, [record.record_id, expanded]);
  const [overflows, setOverflows] = useState(false);
  const original = useRef<HTMLParagraphElement>(null);
  const id = `sentence-${record.record_id}`;
  const sentence = record.sentence || t('savedRecords.missingOriginal');
  const start = record.source?.start_offset;
  const end = record.source?.end_offset;
  const hasRange = start != null && end != null && start >= 0 && end > start && end <= sentence.length;
  const disabled = busy || removing || sourceBusy;
  useTrashDrag(original,{id:`saved:${record.record_id}`,label:sentence,disabled:disabled||!onRemove,remove:async()=>{setError('');try{await onRemove?.(record);return true;}catch(reason){setError(t(savedErrorKey(reason)));return false;}}});

  useLayoutEffect(() => {
    const paragraph = original.current;
    if (!paragraph || expanded) return;
    const measure = () => setOverflows(paragraph.scrollHeight > paragraph.clientHeight + 1);
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);
    });
    observer.observe(paragraph);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [sentence, expanded]);

  const returnToSource = async () => {
    if (!onSource || disabled) return;
    setBusy(true); setError('');
    const generation = sourceIntent.current.generation;
    try { await onSource(record, () => sourceIntent.current.active && sourceIntent.current.generation === generation); }
    catch (reason) { if (reason === 'missing') setSourceMissing(true); else setError(t('savedRecords.sourceError')); }
    finally { setBusy(false); }
  };
  const activate = () => { if (window.getSelection()?.isCollapsed !== false) onActivate(); };
  const sourceName = record.source?.file_name.split(/[\\/]/).at(-1);
  const speechKey = `saved-context:${record.record_id}`;
  return <article className="saved-context-entry saved-sentence" style={fontScaleStyle} data-record={record.record_id} data-active={active}
    role="group" aria-labelledby={`${id}-original`} tabIndex={onRemove ? undefined : 0}
    onClick={event => { if (!(event.target instanceof Element) || !event.target.closest('button,a,input,textarea,summary')) activate(); }}
    onFocusCapture={onActivate} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onActivate(); } }}>
    <div className="saved-sentence-row">
      <div className="saved-sentence-copy">
        <p ref={original} id={`${id}-original`} className="saved-sentence-original" tabIndex={onRemove ? 0 : undefined}
          data-expanded={expanded} lang="en" onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(); }
          }}>
          {hasRange ? <>{sentence.slice(0, start)}<span className="saved-sentence-expression">{sentence.slice(start, end)}</span>{sentence.slice(end)}</> : sentence}
        </p>
        {active && <SpeechButton className="saved-sentence-play" text={record.sentence ?? ''} speechKey={speechKey} kind="sentence"
          media={mediaReady && media ? bindMediaTarget(media, {record_id: record.record_id}) : undefined}
          label={t(mediaReady && media ? 'sourceAudio.playOriginal' : 'sourceAudio.read')}
          idleIcon={<Play size={17} aria-hidden="true"/>} disabled={removing}/>}
        {overflows && <button type="button" className="ui-button saved-sentence-disclosure" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'reader.collapseSentence' : 'reader.expandSentence')}</button>}
        {record.sentence_translation && <p className="saved-sentence-translation" lang="zh">{record.sentence_translation}</p>}
        {active && onSource && sourceName
          ? <button type="button" className="saved-sentence-source recall-source" data-testid="recall-source"
              aria-label={t('savedRecords.returnToSource')} aria-description={sourceName} title={sourceName}
              disabled={disabled || sourceMissing} onClick={() => void returnToSource()}>{sourceName}</button>
          : <small className="saved-sentence-source" title={sourceName}>{sourceName || t('savedRecords.legacyMissingSource')}</small>}
      </div>
    </div>
    {record.explanation_source === 'personal' && record.explanation && <p className="saved-sentence-personal">{t('dictionaryFlow.personalMeaning')}：<span className="saved-sentence-note">{record.explanation}</span></p>}
    {active && media && <SourceAudioControls statusOnly reference={media} target={{record_id: record.record_id}} text={record.sentence ?? ''} speechKey={speechKey}/>}
    <SpeechFeedback speechKeys={[speechKey]}/>
    {record.explanation_source !== 'personal' && record.explanation && <details className="saved-sentence-legacy"><summary>{t('dictionaryFlow.historicalMeaning')}</summary><p>{record.explanation}</p></details>}
    {sourceMissing && record.source && <p className="saved-status" role="status">{t('savedRecords.sourceMissing')}</p>}
    {error && <p className="saved-error" role="alert">{error}</p>}
  </article>;
}
