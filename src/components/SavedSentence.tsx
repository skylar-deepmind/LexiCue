import { createViewCache } from '../lib/pageNavigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Languages, Pencil, Trash2, Volume2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { savedErrorKey, type SavedRecord } from '../lib/savedRecords';
import { LIBRARY_SCOPE, mutateInScope, type ReadingScope } from '../lib/readingScope';
import { savedNoteDrafts } from '../lib/readerNavigation';
import { updateSavedNoteDraft } from './savedNoteDraft';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import Overlay from './Overlay';
import SourceAudioControls from './SourceAudioControls';
import { bindMediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import useContentFontScaleStyle from './useContentFontScaleStyle';

interface Props {
  record: SavedRecord;
  active: boolean;
  onActivate: () => void;
  onChange: (record: SavedRecord) => void;
  onRemove?: (record: SavedRecord) => Promise<void>;
  onSource?: (record: SavedRecord, isCurrent?: () => boolean) => Promise<void>;
  removing?: boolean;
  sourceBusy?: boolean;
  displayReady?: boolean;
  scope?: ReadingScope;
}

/** Stable sentence content; only the selected record mounts its action row. */
const sentenceViews=createViewCache<{translated:boolean;expanded:boolean}>(128);
export default function SavedSentence({ record, active, onActivate, onChange, onRemove, onSource, removing = false, sourceBusy = false, displayReady = true, scope = LIBRARY_SCOPE }: Props) {
  const { t } = useTranslation();
  const fontScaleStyle = useContentFontScaleStyle();
  const media = record.source?.media;
  const mediaReady = useSourceMediaStore(state => !!media && state.entries[media.source.key]?.status === 'ready');
  const sourceIntent = useRef({ active, generation: 0 });
  if (sourceIntent.current.active !== active) { sourceIntent.current.active = active; sourceIntent.current.generation++; }
  useEffect(() => () => { sourceIntent.current.generation++; }, []);
  const initial = useRef(savedNoteDrafts.get(record.record_id));
  const [editing, setEditing] = useState(!!initial.current?.editing);
  const [draft, setDraft] = useState(initial.current?.text ?? (record.explanation_source === 'personal' ? record.explanation ?? '' : ''));
  const revision = useRef(initial.current?.revision ?? record.revision);
  const operation = useRef(initial.current?.operationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceMissing, setSourceMissing] = useState(!record.source);
  const [translated, setTranslated] = useState(sentenceViews.get(record.record_id)?.translated ?? false);
  const [expanded, setExpanded] = useState(sentenceViews.get(record.record_id)?.expanded ?? false);
  useLayoutEffect(()=>sentenceViews.set(record.record_id,{translated,expanded}),[record.record_id,translated,expanded]);
  const [overflows, setOverflows] = useState(false);
  const original = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const id = `sentence-${record.record_id}`;
  const sentence = record.sentence || t('savedRecords.missingOriginal');
  const start = record.source?.start_offset;
  const end = record.source?.end_offset;
  const hasRange = start != null && end != null && start >= 0 && end > start && end <= sentence.length;
  const disabled = busy || removing || sourceBusy;

  useEffect(() => {
    if (editing || savedNoteDrafts.has(record.record_id)) return;
    revision.current = record.revision;
    setDraft(record.explanation_source === 'personal' ? record.explanation ?? '' : '');
  }, [editing, record.record_id, record.revision, record.explanation, record.explanation_source]);
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

  const closeEditor = () => {
    if (busy) return false;
    savedNoteDrafts.set(record.record_id, updateSavedNoteDraft(savedNoteDrafts.get(record.record_id), draft, revision.current, false));
    setEditing(false);
    return true;
  };
  const beginEdit = () => {
    if (!savedNoteDrafts.has(record.record_id)) revision.current = record.revision;
    savedNoteDrafts.set(record.record_id, updateSavedNoteDraft(savedNoteDrafts.get(record.record_id), draft, revision.current, true));
    setEditing(true); setError('');
  };
  const save = async () => {
    if (disabled) return;
    setBusy(true); setError(''); operation.current ??= crypto.randomUUID();
    savedNoteDrafts.set(record.record_id, { text: draft, revision: revision.current, operationId: operation.current, editing: true });
    try {
      const result = await mutateInScope(scope, { kind: 'edit', record_id: record.record_id, expected_revision: revision.current, explanation: draft }, operation.current);
      revision.current = result.record.revision; operation.current = undefined;
      savedNoteDrafts.delete(record.record_id); onChange(result.record); setEditing(false);
    } catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setBusy(false); }
  };
  const returnToSource = async () => {
    if (!onSource || disabled) return;
    setBusy(true); setError('');
    const generation = sourceIntent.current.generation;
    try { await onSource(record, () => sourceIntent.current.active && sourceIntent.current.generation === generation); }
    catch (reason) { if (reason === 'missing') setSourceMissing(true); else setError(t('savedRecords.sourceError')); }
    finally { setBusy(false); }
  };
  const activate = () => { if (window.getSelection()?.isCollapsed !== false) onActivate(); };
  const speechKey = `saved-context:${record.record_id}`;
  return <article className="saved-context-entry saved-sentence" style={fontScaleStyle} data-record={record.record_id} data-active={active}
    role="group" aria-labelledby={`${id}-original`} tabIndex={active ? -1 : 0}
    onClick={event => { if (!(event.target instanceof Element) || !event.target.closest('button,a,input,textarea,summary')) activate(); }}
    onFocusCapture={() => onActivate()} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onActivate(); } }}>
    <p ref={original} id={`${id}-original`} className="saved-sentence-original" data-expanded={expanded} lang="en">
      {hasRange ? <>{sentence.slice(0, start)}<span className="saved-sentence-expression">{sentence.slice(start, end)}</span>{sentence.slice(end)}</> : sentence}
    </p>
    {overflows && <button type="button" className="ui-button saved-sentence-disclosure" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'reader.collapseSentence' : 'reader.expandSentence')}</button>}
    {translated && record.sentence_translation && <p className="saved-sentence-translation">{record.sentence_translation}</p>}
    {record.explanation_source === 'personal' && record.explanation && <p className="saved-sentence-personal">{t('dictionaryFlow.personalMeaning')}：<span className="saved-sentence-note">{record.explanation}</span></p>}
    <small className="saved-sentence-source">{record.source ? t('savedRecords.source', { name: record.source.file_name, index: record.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small>
    {active && <div className="saved-sentence-actions saved-record-actions" role="group" aria-label={t('reader.sentenceActions')}>
      <SpeechButton text={record.sentence ?? ''} speechKey={speechKey} kind="sentence" media={mediaReady && media?.source.audio ? bindMediaTarget(media, {record_id: record.record_id}) : undefined} label={t(mediaReady && media?.source.audio ? 'sourceAudio.playOriginal' : 'sourceAudio.read')} idleIcon={<Volume2 size={20} strokeWidth={1.8} aria-hidden="true" />} disabled={removing}/>
      <button type="button" className="ui-button ui-button--icon" aria-label={t('reader.toggleTranslation')} title={t(record.sentence_translation ? 'reader.toggleTranslation' : 'reader.noSavedTranslation')} aria-pressed={translated} disabled={!record.sentence_translation} onClick={() => setTranslated(value => !value)}><Languages size={20} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" className="ui-button ui-button--icon recall-source" data-testid="recall-source" aria-label={t('savedRecords.returnToSource')} title={t('savedRecords.returnToSource')} disabled={disabled || sourceMissing || !onSource} onClick={() => void returnToSource()}><ExternalLink size={20} strokeWidth={1.8} aria-hidden="true" /></button>
      <button ref={editButton} type="button" className="ui-button ui-button--icon" aria-label={t('reader.personalExplanation')} title={t('reader.personalExplanation')} disabled={disabled} onClick={beginEdit}><Pencil size={20} strokeWidth={1.8} aria-hidden="true" /></button>
      <button type="button" className="ui-button ui-button--icon saved-sentence-remove" aria-label={t('dictionaryFlow.removeSentence')} title={t('dictionaryFlow.removeSentence')} disabled={disabled || !onRemove} onClick={() => { setError(''); void onRemove?.(record).catch(reason => setError(t(savedErrorKey(reason)))); }}><Trash2 size={20} strokeWidth={1.8} aria-hidden="true" /></button>
    </div>}
    {active && media?.source.audio && <SourceAudioControls statusOnly reference={media} target={{record_id: record.record_id}} text={record.sentence ?? ''} speechKey={speechKey}/>}
    <SpeechFeedback speechKeys={[speechKey]}/>
    {record.explanation_source !== 'personal' && record.explanation && <details className="saved-sentence-legacy"><summary>{t('dictionaryFlow.historicalMeaning')}</summary><p>{record.explanation}</p></details>}
    {sourceMissing && record.source && <p className="saved-status" role="status">{t('savedRecords.sourceMissing')}</p>}
    {error && !editing && <p className="saved-error" role="alert">{error}</p>}
    {editing && active && displayReady && <Overlay label={t('dictionaryFlow.personalMeaning')} variant="sheet" className="sentence-note-dialog" onClose={closeEditor} returnFocus={() => editButton.current} initialFocus={() => editor.current}>
      <header><h2>{t('dictionaryFlow.personalMeaning')}</h2><button type="button" className="ui-button ui-button--icon" aria-label={t('common.cancel')} title={t('common.cancel')} disabled={busy} onClick={closeEditor}><X size={20} strokeWidth={1.8} aria-hidden="true" /></button></header>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="sr-only" htmlFor={`${id}-note`}>{t('dictionaryFlow.personalMeaning')}</label>
        <textarea ref={editor} id={`${id}-note`} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); operation.current = undefined; savedNoteDrafts.set(record.record_id, { text: event.target.value, revision: revision.current, editing: true }); }}/>
        {error && <p className="saved-error" role="alert">{error}</p>}
        <button className="ui-button saved-primary" type="submit" disabled={busy || removing}>{t('savedRecords.saveExplanation')}</button>
      </form>
    </Overlay>}
  </article>;
}
