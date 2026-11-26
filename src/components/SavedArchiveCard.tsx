import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCover from './MaterialCover';
import SavedExcerpt from './SavedExcerpt';
import useTrashDrag from './useTrashDrag';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import { savedCover } from '../lib/materialCover';
import type { SavedRecord } from '../lib/savedRecords';

export function SavedArchiveCard({ record, current, sourceBusy, removing, onSource, onRemove, onActivate }: {
  record: SavedRecord; current: boolean; sourceBusy: boolean; removing: boolean;
  onSource: () => void; onRemove: () => Promise<boolean>; onActivate: () => void;
}) {
  const { t } = useTranslation();
  const paragraph = useRef<HTMLParagraphElement>(null);
  useTrashDrag(paragraph, {
    id: `saved:${record.record_id}`, label: record.sentence ?? record.expression, disabled: removing, remove: onRemove,
  });
  const sentence = record.sentence ?? t('savedRecords.missingOriginal');
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
  </article>;
}

export function SavedArchiveGloss({ record, summary }: { record: SavedRecord; summary?: string | null }) {
  const explanation = record.explanation?.trim() || record.dictionary_snapshot?.meaning.zh
    || record.dictionary_reference?.senses.find(sense => sense.meaning.zh)?.meaning.zh
    || summary;
  return explanation ? <p className="approved-folio-note">{explanation}</p> : null;
}
