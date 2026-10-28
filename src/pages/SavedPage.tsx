import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark, MoreHorizontal, Search, Trash2 } from 'lucide-react';
import ContextPanel from '../components/ContextPanel';
import SoftContentRefresh from '../components/SoftContentRefresh';
import SavedDictionaryDetails from '../components/SavedDictionaryDetails';
import SavedReferenceDetails from '../components/SavedReferenceDetails';
import { useImportStore } from '../stores/importStore';
import { legacyContent, mutateSaved, savedErrorKey, undoSaved, type SavedConflict, type SavedMigrationReport, type SavedRecord, type SavedGroup, type SavedGroupPage, type SavedContextPage } from '../lib/savedRecords';

const PAGE_SIZE = 50;
const CONTEXT_PAGE_SIZE = 20;
interface EditDraft { text: string; revision: string; operationId?: string }

/** Editing and removal belong to one source record, never to the whole word. */
function SavedContext({ record, drafts, removing, displayReady, onRemove, onChange, onReturn }: {
  record: SavedRecord; drafts: Map<string, EditDraft>; removing: boolean; displayReady: boolean;
  onRemove: (record: SavedRecord) => Promise<void>; onChange: (record: SavedRecord) => void; onReturn: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const initial = useRef(drafts.get(record.record_id));
  const editor = useRef<HTMLTextAreaElement>(null);
  const restoredDraftFocus = useRef(false);
  const [editing, setEditing] = useState(!!initial.current);
  const [draft, setDraft] = useState(initial.current?.text ?? (record.explanation_source === 'personal' ? record.explanation ?? '' : ''));
  const expectedRevision = useRef(initial.current?.revision ?? record.revision);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [sourceMissing, setSourceMissing] = useState(!record.source);
  const pending = useRef<{ value: string; operationId: string } | null>(initial.current?.operationId ? { value: initial.current.text, operationId: initial.current.operationId } : null);
  const legacyNotes = legacyContent(record.legacy);
  const editorId = `saved-explanation-${record.record_id}`;
  useLayoutEffect(() => {
    // A restored editor can mount while its incoming content is still inert.
    // Apply its existing autofocus intent once the selected detail is available.
    if (displayReady && editing && initial.current && !restoredDraftFocus.current) {
      restoredDraftFocus.current = true; editor.current?.focus();
    }
  }, [displayReady, editing]);
  const save = async () => {
    if (busy || removing) return;
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
    if (busy) return;
    setBusy(true); setError('');
    try {
      const location = await invoke<{ file_id: number; segment_index: number } | null>('saved_record_source', { recordId: record.record_id });
      if (location) { onReturn(); navigate(`/files/${location.file_id}?segment=${location.segment_index}`); }
      else setSourceMissing(true);
    } catch { setError(t('savedRecords.sourceError')); }
    finally { setBusy(false); }
  };
  return <article className="saved-context-entry" data-record={record.record_id}>
    <section className="saved-context-copy">
      <h3>{t('savedRecords.original')}</h3><p lang="en">{record.sentence || t('savedRecords.missingOriginal')}</p>
      {record.sentence_translation && <p>{record.sentence_translation}</p>}
      <small>{record.source ? t('savedRecords.source', { name: record.source.file_name, index: record.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small>
      <small className="saved-time">{record.saved_at === null ? t('savedRecords.unknownTime') : new Date(record.saved_at).toLocaleString(i18n.language)}</small>
    </section>
    {editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={editorId}>{t('dictionaryFlow.personalMeaning')}</label>
      <textarea ref={editor} id={editorId} value={draft} onChange={event => { setDraft(event.target.value); drafts.set(record.record_id, { text: event.target.value, revision: expectedRevision.current }); }} autoFocus disabled={busy || removing} />
      <div className="saved-detail-actions"><button className="ui-button saved-primary" type="submit" disabled={busy || removing}>{t('savedRecords.saveChanges')}</button>
        <button className="ui-button" type="button" disabled={busy || removing} onClick={() => { setEditing(false); drafts.delete(record.record_id); setDraft(record.explanation_source === 'personal' ? record.explanation ?? '' : ''); pending.current = null; setError(''); }}>{t('common.cancel')}</button></div>
    </form> : record.explanation ? <section className="saved-context-meaning">
      <small className="saved-history-label">{record.explanation_source === 'personal' ? t('dictionaryFlow.personalMeaning') : `${t('dictionaryFlow.savedMeaning')} · ${t(`savedRecords.sources.${record.explanation_source}`)}`}</small>
      <p className="saved-detail-meaning">{record.explanation}</p>
    </section> : null}
    {record.dictionary_reference && <SavedReferenceDetails reference={record.dictionary_reference} />}
    {record.dictionary_snapshot && <SavedDictionaryDetails snapshot={record.dictionary_snapshot} />}
    {legacyNotes.length > 0 && <details className="saved-legacy"><summary>{t('savedRecords.legacyDetails')}</summary>{legacyNotes.map((note, index) => <div key={index}><small>{t(note.label)}</small><p>{note.text}</p></div>)}</details>}
    <div className="saved-context-actions">
      <button className="ui-button" disabled={busy || editing || sourceMissing} onClick={() => void returnToSource()}>{t('savedRecords.returnToSource')}</button>
      <button className="ui-button ui-button--icon" aria-label={t('savedRecords.more', { expression: record.expression })} aria-expanded={more} onClick={() => setMore(value => !value)} disabled={busy || removing}><MoreHorizontal size={20} aria-hidden="true" /></button>
      {more && <div className="saved-context-secondary">
        <button className="ui-button" disabled={busy || removing || editing} onClick={() => { expectedRevision.current = record.revision; setEditing(true); setMore(false); }}>{t('reader.personalExplanation')}</button>
        <button className="ui-button saved-remove" disabled={busy || removing || editing} onClick={() => { setError(''); void onRemove(record).catch(reason => setError(t(savedErrorKey(reason)))); }}><Trash2 size={16} aria-hidden="true" />{t('dictionaryFlow.removeSentence')}</button>
      </div>}
    </div>
    {sourceMissing && <p className="saved-status" role="status">{t('savedRecords.sourceMissing')}</p>}
    {error && <p className="saved-error" role="alert">{error}</p>}
  </article>;
}

interface SavedGroupDetailProps {
  group: SavedGroup; revision: number; drafts: Map<string, EditDraft>; pendingRemove: string | null;
  undo: string | null; undoBusy: boolean; undoButton: RefObject<HTMLButtonElement | null>; onUndo: () => Promise<void>;
  onClose: () => void; onClosing: () => void; onRemove: (record: SavedRecord) => Promise<void>;
}

/** The frame stays mounted while only its requested contents change. Readiness
 * belongs to this selection, including a return to a still-loading earlier word. */
function SavedGroupDetail(props: SavedGroupDetailProps) {
  const { t } = useTranslation();
  const id = props.group.group_id;
  const [prepared, setPrepared] = useState({ id, ready: false });
  if (prepared.id !== id) setPrepared({ id, ready: false });
  const onReady = useCallback(() => {
    setPrepared(current => current.id === id && !current.ready ? { id, ready: true } : current);
  }, [id]);
  const ready = prepared.id === id && prepared.ready;
  return <ContextPanel label={props.group.expression} interactionKey={id} onClose={props.onClose} onClosing={props.onClosing}>
    <SoftContentRefresh contentKey={id} ready={ready} label={props.group.expression} pendingLabel={t('common.loading')}>
      <SavedGroupContent key={id} {...props} displayReady={ready} onReady={onReady} />
    </SoftContentRefresh>
  </ContextPanel>;
}

function SavedGroupContent({ group, revision, drafts, pendingRemove, undo, undoBusy, undoButton, onUndo, onClose, onRemove, onReady, displayReady }: SavedGroupDetailProps & { onReady: () => void; displayReady: boolean }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<SavedContextPage>({ records: [], total: group.context_count });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const close = useRef(onClose);
  close.current = onClose;
  const load = useCallback(async (offset = 0) => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const next = await invoke<SavedContextPage>('saved_group_contexts', { groupId: group.group_id, limit: CONTEXT_PAGE_SIZE, offset });
      if (request.current !== current) return;
      setPage(previous => ({ records: offset ? [...previous.records, ...next.records] : next.records, total: next.total }));
      if (!next.total) close.current();
    } catch { if (request.current === current) setError(t('savedRecords.loadError')); }
    finally { if (request.current === current) setLoading(false); }
  }, [group.group_id, t]);
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useLayoutEffect(() => invalidateRequest, [invalidateRequest]);
  useEffect(() => { void load(); return invalidateRequest; }, [load, revision, retry, invalidateRequest]);
  useLayoutEffect(() => { if (!loading) onReady(); }, [loading, onReady]);
  useLayoutEffect(() => { if (displayReady && undo) undoButton.current?.focus({ preventScroll: true }); }, [displayReady, undo, undoButton]);
  return <>
    <header className="saved-detail-heading"><span>{t('dictionaryFlow.contextCount', { count: page.total })}</span><h2 lang="en">{group.expression}</h2></header>
    <div className="saved-detail-body saved-group-contexts" aria-busy={loading}>
      {loading && !page.records.length && <p className="saved-status" role="status">{t('common.loading')}</p>}
      {page.records.map(record => <SavedContext key={record.record_id} record={record} drafts={drafts} removing={pendingRemove !== null} displayReady={displayReady} onRemove={onRemove} onReturn={onClose} onChange={next => setPage(previous => ({ ...previous, records: previous.records.map(value => value.record_id === next.record_id ? next : value) }))} />)}
      {error && <div className="saved-error" role="alert"><p>{error}</p><button className="ui-button" onClick={() => setRetry(value => value + 1)} disabled={loading}>{t('common.retry')}</button></div>}
      {page.records.length < page.total && <button className="ui-button" disabled={loading} onClick={() => void load(page.records.length)}>{t('savedRecords.loadMore')}</button>}
    </div>
    {undo && <footer className="saved-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" ref={undoButton} disabled={undoBusy} onClick={() => void onUndo()}>{t('savedRecords.undo')}</button></footer>}
  </>;
}

export function SavedGroupCard({ group, selected, onOpen }: { group: SavedGroup; selected: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const record = group.preview;
  const reference = record.dictionary_reference?.senses.map(sense => sense.meaning.zh || sense.meaning.en).filter(Boolean).slice(0, 2).join('；');
  const summary = reference || record.explanation;
  return <li className="saved-record-row saved-group-row" data-group={group.group_id}>
    <button className="saved-record-open" onClick={onOpen} aria-pressed={selected}>
      <span className="saved-record-term" lang="en">{group.expression}</span><span className="saved-context-count">{t('dictionaryFlow.contextCount', { count: group.context_count })}</span>
      {summary && <div className="saved-record-meaning"><small>{t(reference ? 'dictionaryFlow.savedReference' : record.explanation_source === 'personal' ? 'dictionaryFlow.personalMeaning' : 'dictionaryFlow.savedMeaning')}</small><span>{summary}</span></div>}
      {!summary && <p lang="en">{record.sentence || t('savedRecords.missingOriginal')}</p>}
    </button>
  </li>;
}

export default function SavedPage() {
  const { t } = useTranslation();
  const importOpen = useImportStore(state => state.open);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<SavedGroupPage>({ groups: [], total_groups: 0, total_records: 0 });
  const [selected, setSelected] = useState<SavedGroup | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [loading, setLoading] = useState(true);
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
  useEffect(() => { if (importOpen) setSelected(null); }, [importOpen]);
  useEffect(() => { if (undo) undoButton.current?.focus({ preventScroll: true }); }, [undo, selected?.group_id]);
  const load = useCallback(async (offset = 0) => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const next = await invoke<SavedGroupPage>('list_saved_groups', { query, limit: PAGE_SIZE, offset });
      if (current !== request.current) return;
      setPage(previous => ({ ...next, groups: offset ? [...previous.groups, ...next.groups] : next.groups }));
      setSelected(previous => previous ? next.groups.find(group => group.group_id === previous.group_id) ?? previous : null);
    } catch { if (current === request.current) setError(t('savedRecords.loadError')); }
    finally { if (current === request.current) setLoading(false); }
  }, [query, t]);
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useEffect(() => { setPage({ groups: [], total_groups: 0, total_records: 0 }); void load(); return invalidateRequest; }, [load, invalidateRequest]);
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
    const refresh = () => { setContextRevision(value => value + 1); void load(); };
    const foreground = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('lexicue-saved-changed', refresh);
    window.addEventListener('lexicue-sync-applied', refresh);
    window.addEventListener('lexicue-dictionary-changed', refresh);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('lexicue-saved-changed', refresh);
      window.removeEventListener('lexicue-sync-applied', refresh);
      window.removeEventListener('lexicue-dictionary-changed', refresh);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [load]);
  const remove = async (record: SavedRecord) => {
    if (pendingRemove) return;
    const key = `${record.record_id}:${record.revision}`;
    const operationId = removalReceipts.current.get(key) ?? crypto.randomUUID();
    removalReceipts.current.set(key, operationId);
    setPendingRemove(record.record_id); setError('');
    try {
      const result = await mutateSaved({ kind: 'remove', record_id: record.record_id, expected_revision: record.revision }, operationId);
      if (result.changed) setUndo(result.operation_id);
      removalReceipts.current.delete(key); editDrafts.current.delete(record.record_id);
    } catch (reason) { setError(t(savedErrorKey(reason))); throw reason; }
    finally { setPendingRemove(null); }
  };
  const restore = async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true); setError('');
    try { await undoSaved(undo); setUndo(null); }
    catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setUndoBusy(false); }
  };
  return <div className="saved-page" data-panel-open={!!selected && panelOpen}>
    <div className="saved-scroll"><div className="saved-workspace workspace-paper">
      <div className="saved-heading"><h1>{t('savedRecords.title')}</h1><span role="status">{t('dictionaryFlow.groupCount', { count: page.total_groups, contexts: page.total_records })}</span></div>
      <label className="saved-search"><Search size={18} aria-hidden="true" /><span className="sr-only">{t('savedRecords.search')}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('savedRecords.search')} /></label>
      {error && <div className="saved-error" role="alert"><p>{error}</p><button className="ui-button" onClick={() => void load()}>{t('common.retry')}</button></div>}
      {loading && <p className="saved-status" role="status">{t('common.loading')}</p>}
      {!loading && !error && !page.groups.length && <div className="saved-empty"><Bookmark size={30} aria-hidden="true" /><p>{t(query ? 'savedRecords.noResults' : 'savedRecords.empty')}</p></div>}
      <ul className="saved-record-list" aria-label={t('savedRecords.title')}>
        {page.groups.map(group => <SavedGroupCard key={group.group_id} group={group} selected={selected?.group_id === group.group_id} onOpen={() => { setSelected(group); setPanelOpen(true); }} />)}
      </ul>
      {page.groups.length < page.total_groups && <button className="ui-button" disabled={loading} onClick={() => void load(page.groups.length)}>{t('savedRecords.loadMore')}</button>}
      {report && report.saved_contexts > 0 && <details className="saved-migration"><summary>{t('savedRecords.migrationTitle')}</summary><p>{t('savedRecords.migrationReport', { count: report.saved_contexts, missing: report.missing_sources })}</p></details>}
      {conflicts.length > 0 && <details className="saved-conflicts"><summary>{t('savedRecords.conflicts', { count: conflicts.length })}</summary><p>{t('savedRecords.conflictsHint')}</p>{conflicts.map(conflict => <section key={conflict.id}><h2>{conflict.local.expression}</h2><p>{t('savedRecords.localVersion')}：{conflict.local.explanation || t('savedRecords.noExplanation')}</p><p>{t('savedRecords.remoteVersion')}：{conflict.remote.explanation || t('savedRecords.noExplanation')}</p><p lang="en">{conflict.local.sentence}</p></section>)}</details>}
    </div></div>
    {undo && !selected && <div className="saved-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" ref={undoButton} disabled={undoBusy} onClick={() => void restore()}>{t('savedRecords.undo')}</button></div>}
    {selected && <SavedGroupDetail group={selected} revision={contextRevision} drafts={editDrafts.current} pendingRemove={pendingRemove} undo={undo} undoBusy={undoBusy} undoButton={undoButton} onUndo={restore} onClosing={() => setPanelOpen(false)} onClose={() => setSelected(current => current?.group_id === selected.group_id ? null : current)} onRemove={remove} />}
  </div>;
}
