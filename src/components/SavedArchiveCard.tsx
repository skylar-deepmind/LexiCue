import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2 } from 'lucide-react';
import MaterialCover from './MaterialCover';
import SavedExcerpt from './SavedExcerpt';
import SavedExplanationEditor from './SavedExplanationEditor';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import useTrashDrag from './useTrashDrag';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import { savedCover } from '../lib/materialCover';
import { savedNoteDrafts } from '../lib/readerNavigation';
import { mutateSaved, savedErrorKey, type SavedRecord } from '../lib/savedRecords';
import { bindMediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';

export function SavedArchiveCard({ record, current, sourceBusy, removing, onSource, onRemove, onActivate }: {
  record: SavedRecord; current: boolean; sourceBusy: boolean; removing: boolean;
  onSource: () => void; onRemove: () => Promise<boolean>; onActivate: () => void;
}) {
  const { t } = useTranslation();
  const paragraph = useRef<HTMLParagraphElement>(null);
  useTrashDrag(paragraph, {
    id: `saved:${record.record_id}`, label: record.sentence ?? record.expression, disabled: removing, remove: onRemove,
  });
  const media = record.source?.media;
  const ready = useSourceMediaStore(s => !!media && s.entries[media.source.key]?.status === 'ready');
  const sentence = record.sentence ?? t('savedRecords.missingOriginal');
  const speechKey = `saved-folio:${record.record_id}`;
  const sourceTitle = record.source?.file_name ? bookmarkTitle(record.source.file_name) : t('savedRecords.legacyMissingSource');
  return <article className="approved-saved-folio" data-record={record.record_id} data-current={current}
    onFocus={onActivate} onClick={onActivate}>
    <button type="button" className="approved-source-cover" tabIndex={-1} disabled={!record.source || sourceBusy}
      aria-label={t('savedRecords.returnToSource')} onClick={onSource}>
      <MaterialCover src={savedCover(record)} identity={record.source?.content_hash ?? record.source_key}/>
    </button>
    <div className="approved-folio-copy">
      <button type="button" className="approved-source-title" disabled={!record.source || sourceBusy} onClick={onSource}>{sourceTitle}</button>
      <p ref={paragraph} className="approved-folio-sentence" lang="en" tabIndex={0} aria-label={sentence}>
        <SavedExcerpt record={record} fallback={t('savedRecords.missingOriginal')}/>
      </p>
      {record.sentence_translation && <p className="approved-folio-translation">{record.sentence_translation}</p>}
    </div>
    <SpeechButton className="approved-folio-speech" text={sentence} speechKey={speechKey} kind="sentence"
      label={t(ready && media ? 'sourceAudio.playOriginal' : 'sourceAudio.read')} disabled={!record.sentence}
      media={ready && media ? bindMediaTarget(media, { record_id: record.record_id }) : undefined}
      idleIcon={<Volume2 size={24} strokeWidth={1.65}/>}/>
    <SpeechFeedback speechKeys={[speechKey]}/>
  </article>;
}

function personalNote(record: SavedRecord) {
  return record.explanation_source === 'personal' ? record.explanation ?? '' : '';
}

export function SavedArchiveGloss({ record, summary, onChange }: {
  record: SavedRecord; summary?: string | null; onChange: (record: SavedRecord) => void;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const initial = useRef(savedNoteDrafts.get(record.record_id));
  const [editing, setEditing] = useState(Boolean(initial.current?.editing));
  const [draft, setDraft] = useState(initial.current?.text ?? personalNote(record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(initial.current?.revision ?? record.revision);
  const operation = useRef(initial.current?.operationId);

  useEffect(() => {
    if (!editing && !savedNoteDrafts.has(record.record_id)) {
      revision.current = record.revision;
      setDraft(personalNote(record));
    }
  }, [record, editing]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    operation.current ??= crypto.randomUUID();
    savedNoteDrafts.set(record.record_id, { text: draft, revision: revision.current, operationId: operation.current, editing: true });
    try {
      const result = await mutateSaved({ kind: 'edit', record_id: record.record_id, expected_revision: revision.current, explanation: draft }, operation.current);
      savedNoteDrafts.delete(record.record_id);
      revision.current = result.record.revision;
      operation.current = undefined;
      onChange(result.record);
      setEditing(false);
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    } catch (cause) { setError(savedErrorKey(cause)); }
    finally { setBusy(false); }
  };
  const explanation = record.explanation?.trim() || record.dictionary_snapshot?.meaning.zh
    || record.dictionary_reference?.senses.find(sense => sense.meaning.zh)?.meaning.zh
    || summary;
  return editing ? <SavedExplanationEditor id={record.record_id} value={draft} busy={busy} error={error ? t(error) : ''}
    returnFocus={() => trigger.current}
    onChange={text => {
      setDraft(text);
      operation.current = undefined;
      savedNoteDrafts.set(record.record_id, { text, revision: revision.current, editing: true });
    }}
    onSave={() => void save()} onCancel={() => {
      savedNoteDrafts.delete(record.record_id);
      setDraft(personalNote(record));
      operation.current = undefined;
      revision.current = record.revision;
      setError('');
      setEditing(false);
    }}/>
    : <button ref={trigger} className="approved-folio-note" type="button" aria-expanded={false}
      title={t('savedRecords.edit')} onClick={() => setEditing(true)}>{explanation || t('reader.personalExplanation')}</button>;
}
