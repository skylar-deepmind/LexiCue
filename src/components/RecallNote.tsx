import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { savedErrorKey, type SavedRecord } from '../lib/savedRecords';
import { mutateInScope, LIBRARY_SCOPE, type ReadingScope } from '../lib/readingScope';
import { savedNoteDrafts } from '../lib/readerNavigation';

/** Edit the old context itself; never copy its note onto the current sentence. */
export default function RecallNote({record, onChange, scope=LIBRARY_SCOPE}: {scope?:ReadingScope; record: SavedRecord; onChange: (record: SavedRecord) => void}) {
  const {t} = useTranslation();
  const restored = useRef(savedNoteDrafts.get(record.record_id));
  const [editing, setEditing] = useState(!!restored.current?.editing);
  const [draft, setDraft] = useState(restored.current?.text ?? (record.explanation_source === 'personal' ? record.explanation ?? '' : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(restored.current?.revision ?? record.revision);
  const operation = useRef(restored.current?.operationId);
  useEffect(() => {
    if (editing || savedNoteDrafts.has(record.record_id)) return;
    revision.current = record.revision;
    setDraft(record.explanation_source === 'personal' ? record.explanation ?? '' : '');
  }, [editing, record.record_id, record.revision, record.explanation, record.explanation_source]);
  const begin = () => {
    if (!savedNoteDrafts.has(record.record_id)) revision.current = record.revision;
    savedNoteDrafts.set(record.record_id, {text:draft,revision:revision.current,editing:true});
    setEditing(true);
  };
  const collapse = () => {
    savedNoteDrafts.set(record.record_id, {text:draft,revision:revision.current,operationId:operation.current,editing:false});
    setEditing(false);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); operation.current ??= crypto.randomUUID();
    savedNoteDrafts.set(record.record_id, {text:draft,revision:revision.current,operationId:operation.current,editing:true});
    try {
      const result = await mutateInScope(scope, {kind:'edit',record_id:record.record_id,expected_revision:revision.current,explanation:draft},operation.current);
      revision.current = result.record.revision; operation.current = undefined;
      savedNoteDrafts.delete(record.record_id); onChange(result.record); setEditing(false);
    } catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setBusy(false); }
  };
  return <div className="recall-note-editor">
    <button className="ui-button ui-button--icon" aria-label={t('reader.personalExplanation')} aria-expanded={editing} disabled={busy} onClick={() => editing ? collapse() : begin()}><Pencil size={18} aria-hidden="true"/></button>
    {editing && <form onSubmit={event=>{event.preventDefault();void save();}}>
      <label>{t('dictionaryFlow.personalMeaning')}<textarea autoFocus value={draft} disabled={busy} onChange={event=>{setDraft(event.target.value);operation.current=undefined;savedNoteDrafts.set(record.record_id,{text:event.target.value,revision:revision.current,editing:true});}}/></label>
      <div><button className="ui-button" disabled={busy}>{t('savedRecords.saveChanges')}</button><button className="ui-button" type="button" disabled={busy} onClick={()=>{savedNoteDrafts.delete(record.record_id);setDraft(record.explanation_source==='personal'?record.explanation??'':'');operation.current=undefined;setEditing(false);setError('');}}>{t('common.cancel')}</button></div>
    </form>}
    {error && <p className="saved-error" role="alert">{error}</p>}
  </div>;
}
