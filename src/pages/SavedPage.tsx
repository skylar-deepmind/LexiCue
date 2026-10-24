import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark, MoreHorizontal, Search, Trash2 } from 'lucide-react';
import ContextPanel from '../components/ContextPanel';
import { useImportStore } from '../stores/importStore';
import { legacyContent, mutateSaved, savedErrorKey, undoSaved, type SavedConflict, type SavedMigrationReport, type SavedRecord } from '../lib/savedRecords';

const PAGE_SIZE = 200;
interface EditDraft { text: string; revision: string; operationId?: string }

function SavedDetail({ record, onClose, onChange, onClosing, drafts }: {
  record: SavedRecord; onClose: () => void; onChange: (record: SavedRecord) => void; onClosing: () => void;
  drafts: Map<string, EditDraft>;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const initial = useRef(drafts.get(record.record_id));
  const [editing, setEditing] = useState(!!initial.current);
  const [draft, setDraft] = useState(initial.current?.text ?? record.explanation ?? '');
  const expectedRevision = useRef(initial.current?.revision ?? record.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceMissing, setSourceMissing] = useState(false);
  const pending = useRef<{ value: string; operationId: string } | null>(initial.current?.operationId ? { value: initial.current.text, operationId: initial.current.operationId } : null);
  const legacyNotes = legacyContent(record.legacy);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    if (pending.current?.value !== draft) pending.current = { value: draft, operationId: crypto.randomUUID() };
    drafts.set(record.record_id, { text: draft, revision: expectedRevision.current, operationId: pending.current!.operationId });
    try {
      const result = await mutateSaved({ kind: 'edit', record_id: record.record_id, expected_revision: expectedRevision.current, explanation: draft }, pending.current!.operationId);
      expectedRevision.current = result.record.revision; drafts.delete(record.record_id);
      onChange(result.record); pending.current = null; setEditing(false);
    } catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setBusy(false); }
  };
  const returnToSource = async () => {
    setBusy(true); setError('');
    try {
      const location = await invoke<{ file_id: number; segment_index: number } | null>('saved_record_source', { recordId: record.record_id });
      if (location) { onClose(); navigate(`/files/${location.file_id}?segment=${location.segment_index}`); }
      else setSourceMissing(true);
    } catch { setError(t('savedRecords.sourceError')); }
    finally { setBusy(false); }
  };
  return <ContextPanel label={record.expression} onClose={onClose} onClosing={onClosing}>
    <header className="saved-detail-heading"><span>{t('savedRecords.context')}</span><h2>{record.expression}</h2></header>
    <div className="saved-detail-body">
      {editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="saved-explanation">{t('savedRecords.explanation')}</label>
        <textarea id="saved-explanation" value={draft} onChange={event => { setDraft(event.target.value); drafts.set(record.record_id, { text: event.target.value, revision: expectedRevision.current }); }} autoFocus disabled={busy} />
        <div className="saved-detail-actions"><button className="ui-button saved-primary" type="submit" disabled={busy}>{t('savedRecords.saveChanges')}</button>
          <button className="ui-button" type="button" disabled={busy} onClick={() => { setEditing(false); drafts.delete(record.record_id); setDraft(record.explanation ?? ''); setError(''); }}>{t('common.cancel')}</button></div>
      </form> : <><p className="saved-detail-meaning">{record.explanation || t('savedRecords.noExplanation')}</p>
        <div className="saved-detail-actions"><small>{t(`savedRecords.sources.${record.explanation_source}`)}</small><button className="ui-button" onClick={() => setEditing(true)}>{t('savedRecords.edit')}</button></div></>}
      <section className="saved-context-copy"><h3>{t('savedRecords.original')}</h3><p lang="en">{record.sentence || t('savedRecords.missingOriginal')}</p>
        {record.sentence_translation && <p>{record.sentence_translation}</p>}
        <small>{record.source ? t('savedRecords.source', { name: record.source.file_name, index: record.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small>
      </section>
      <small className="saved-time">{record.saved_at === null ? t('savedRecords.unknownTime') : new Date(record.saved_at).toLocaleString(i18n.language)}</small>
      {legacyNotes.length > 0 && <details className="saved-legacy"><summary>{t('savedRecords.legacyDetails')}</summary>{legacyNotes.map((note, index) => <div key={index}><small>{t(note.label)}</small><p>{note.text}</p></div>)}</details>}
      {sourceMissing && <p role="status">{t('savedRecords.sourceMissing')}</p>}
      {error && <p className="saved-error" role="alert">{error}</p>}
    </div>
    <footer className="saved-detail-footer"><button className="ui-button saved-primary" disabled={busy || editing || !record.source || sourceMissing} onClick={() => void returnToSource()}>{t('savedRecords.returnToSource')}</button></footer>
  </ContextPanel>;
}

export default function SavedPage() {
  const { t } = useTranslation();
  const importOpen=useImportStore(state=>state.open);
  useEffect(()=>{if(importOpen)setSelected(null);},[importOpen]);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [selected, setSelected] = useState<SavedRecord | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [more, setMore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [report, setReport] = useState<SavedMigrationReport | null>(null);
  const [conflicts, setConflicts] = useState<SavedConflict[]>([]);
  const request = useRef(0);
  const removalReceipts = useRef(new Map<string, string>());
  const editDrafts = useRef(new Map<string, EditDraft>());
  const undoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (undo) undoButton.current?.focus({ preventScroll: true }); }, [undo]);
  const load = useCallback(async (append = false, offset = 0) => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const next = await invoke<SavedRecord[]>('list_saved_records', { query, limit: PAGE_SIZE, offset });
      if (current !== request.current) return;
      setRecords(previous => append ? [...previous, ...next] : next); setHasMore(next.length === PAGE_SIZE);
    } catch { if (current === request.current) setError(t('savedRecords.loadError')); }
    finally { if (current === request.current) setLoading(false); }
  }, [query, t]);
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useEffect(() => { setRecords([]); void load(); return invalidateRequest; }, [load, invalidateRequest]);
  useEffect(() => {
    const metadata = () => {
      void invoke<SavedMigrationReport>('saved_migration_report').then(setReport).catch(() => {});
      void invoke<SavedConflict[]>('saved_record_conflicts').then(setConflicts).catch(() => {});
    };
    metadata();
    window.addEventListener('lexicue-sync-applied', metadata);
    return () => window.removeEventListener('lexicue-sync-applied', metadata);
  }, []);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('lexicue-sync-applied', refresh);
    return () => window.removeEventListener('lexicue-sync-applied', refresh);
  }, [load]);
  const remove = async (record: SavedRecord) => {
    if (pendingRemove) return;
    const key = `${record.record_id}:${record.revision}`;
    const operationId = removalReceipts.current.get(key) ?? crypto.randomUUID();
    removalReceipts.current.set(key, operationId);
    setPendingRemove(record.record_id); setError('');
    try {
      const result = await mutateSaved({ kind: 'remove', record_id: record.record_id, expected_revision: record.revision }, operationId);
      setMore(null); if (result.changed) setUndo(result.operation_id);
      setRecords(previous => previous.filter(item => item.record_id !== record.record_id));
      if (selected?.record_id === record.record_id) setSelected(null);
      removalReceipts.current.delete(key);
    } catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setPendingRemove(null); }
  };
  const restore = async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true); setError('');
    try { await undoSaved(undo); setUndo(null); await load(); }
    catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setUndoBusy(false); }
  };
  return <div className="saved-page" data-panel-open={!!selected && panelOpen}>
    <div className="saved-scroll"><div className="saved-workspace workspace-paper">
      <div className="saved-heading"><h1>{t('savedRecords.title')}</h1><span role="status">{t('savedRecords.shown', { count: records.length })}</span></div>
      <label className="saved-search"><Search size={18} aria-hidden="true" /><span className="sr-only">{t('savedRecords.search')}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('savedRecords.search')} /></label>
      {error && <div className="saved-error" role="alert"><p>{error}</p><button className="ui-button" onClick={() => void load()}>{t('common.retry')}</button></div>}
      {loading && <p className="saved-status" role="status">{t('common.loading')}</p>}
      {!loading && !error && !records.length && <div className="saved-empty"><Bookmark size={30} aria-hidden="true" /><p>{t(query ? 'savedRecords.noResults' : 'savedRecords.empty')}</p></div>}
      <ul className="saved-record-list" aria-label={t('savedRecords.title')}>
        {records.map(record => <li key={record.record_id} className="saved-record-row">
          <button className="saved-record-open" onClick={() => { setSelected(record); setPanelOpen(true); setMore(null); }} aria-pressed={selected?.record_id === record.record_id}>
            <span className="saved-record-term" lang="en">{record.expression}</span><span className="saved-record-meaning">{record.explanation || t('savedRecords.noExplanation')}</span>
            <p lang="en">{record.sentence || t('savedRecords.missingOriginal')}</p><small>{record.source ? t('savedRecords.source', { name: record.source.file_name, index: record.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small>
          </button>
          <div className="saved-row-actions"><button className="ui-button ui-button--icon" aria-label={t('savedRecords.more', { expression: record.expression })} aria-expanded={more === record.record_id} onClick={() => setMore(more === record.record_id ? null : record.record_id)}><MoreHorizontal size={20} aria-hidden="true" /></button>
            {more === record.record_id && <button className="ui-button saved-remove" disabled={pendingRemove !== null} onClick={() => void remove(record)}><Trash2 size={16} aria-hidden="true" />{t('savedRecords.remove')}</button>}</div>
        </li>)}
      </ul>
      {hasMore && <button className="ui-button" disabled={loading} onClick={() => void load(true, records.length)}>{t('savedRecords.loadMore')}</button>}
      {report && report.saved_contexts > 0 && <details className="saved-migration"><summary>{t('savedRecords.migrationTitle')}</summary><p>{t('savedRecords.migrationReport', { count: report.saved_contexts, missing: report.missing_sources })}</p></details>}
      {conflicts.length > 0 && <details className="saved-conflicts"><summary>{t('savedRecords.conflicts', { count: conflicts.length })}</summary><p>{t('savedRecords.conflictsHint')}</p>{conflicts.map(conflict => <section key={conflict.id}><h2>{conflict.local.expression}</h2><p>{t('savedRecords.localVersion')}：{conflict.local.explanation || t('savedRecords.noExplanation')}</p><p>{t('savedRecords.remoteVersion')}：{conflict.remote.explanation || t('savedRecords.noExplanation')}</p><p lang="en">{conflict.local.sentence}</p></section>)}</details>}
    </div></div>
    {undo && <div className="saved-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" ref={undoButton} disabled={undoBusy} onClick={() => void restore()}>{t('savedRecords.undo')}</button></div>}
    {selected && <SavedDetail key={selected.record_id} record={selected} drafts={editDrafts.current} onClosing={() => setPanelOpen(false)} onClose={() => setSelected(null)} onChange={next => { setSelected(current => current?.record_id === next.record_id ? next : current); setRecords(previous => previous.map(record => record.record_id === next.record_id ? next : record)); }} />}
  </div>;
}
