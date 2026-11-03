import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark, ChevronRight, ExternalLink, Pencil, Search, Trash2, Undo2 } from 'lucide-react';
import MotionChange from '../components/MotionChange';
import { readPaged } from '../components/readPaged';
import { updateSavedNoteDraft } from '../components/savedNoteDraft';
import SourceAudioControls from '../components/SourceAudioControls';
import { useQuietScrollbars } from '../components/useQuietScrollbars';
import { useImportStore } from '../stores/importStore';
import { backNavigation } from '../lib/backNavigation';
import { readerNavigation, resolveSavedSource, savedNoteDrafts, type SavedNoteDraft, type SavedViewSnapshot } from '../lib/readerNavigation';
import { documentLocationLabel } from '../lib/documentTypes';
import { mutateSaved, savedErrorKey, undoSaved, type SavedConflict, type SavedMigrationReport, type SavedRecord, type SavedGroup, type SavedGroupPage, type SavedContextPage } from '../lib/savedRecords';

const PAGE_SIZE = 50;
const CONTEXT_PAGE_SIZE = 20;
type EditDraft = SavedNoteDraft;

/** Editing and removal belong to one source record, never to the whole word. */
function SavedContext({ record, drafts, removing, displayReady, onRemove, onChange, onReturn }: {
  record: SavedRecord; drafts: Map<string, EditDraft>; removing: boolean; displayReady: boolean;
  onRemove: (record: SavedRecord) => Promise<void>; onChange: (record: SavedRecord) => void; onReturn: (record: SavedRecord) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const initial = useRef(drafts.get(record.record_id));
  const editor = useRef<HTMLTextAreaElement>(null);
  const restoredDraftFocus = useRef(false);
  const [editing, setEditing] = useState(!!initial.current?.editing);
  const [draft, setDraft] = useState(initial.current?.text ?? (record.explanation_source === 'personal' ? record.explanation ?? '' : ''));
  const expectedRevision = useRef(initial.current?.revision ?? record.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceMissing, setSourceMissing] = useState(!record.source);
  const pending = useRef<{ value: string; operationId: string } | null>(initial.current?.operationId ? { value: initial.current.text, operationId: initial.current.operationId } : null);
  const editorId = `saved-explanation-${record.record_id}`;
  useLayoutEffect(() => {
    // A restored editor can mount while its incoming content is still inert.
    // Apply its existing autofocus intent once the selected detail is available.
    if (displayReady && editing && initial.current && !restoredDraftFocus.current) {
      restoredDraftFocus.current = true; editor.current?.focus({preventScroll:true});
    }
  }, [displayReady, editing]);
  const save = async () => {
    if (busy || removing) return;
    setBusy(true); setError('');
    if (pending.current?.value !== draft) pending.current = { value: draft, operationId: crypto.randomUUID() };
    drafts.set(record.record_id, { text: draft, revision: expectedRevision.current, operationId: pending.current!.operationId, editing: true });
    try {
      const result = await mutateSaved({ kind: 'edit', record_id: record.record_id, expected_revision: expectedRevision.current, explanation: draft }, pending.current!.operationId);
      expectedRevision.current = result.record.revision;
      if (drafts.get(record.record_id)?.operationId === pending.current?.operationId) drafts.delete(record.record_id);
      onChange(result.record); pending.current = null; setEditing(false);
    } catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setBusy(false); }
  };
  const returnToSource = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onReturn(record); } catch (reason) {
      if (reason === 'missing') setSourceMissing(true); else setError(t('savedRecords.sourceError'));
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!editing || !displayReady) return;
    const dismiss = () => { drafts.set(record.record_id, updateSavedNoteDraft(drafts.get(record.record_id), draft, expectedRevision.current, false)); setEditing(false); return true; };
    const unregister = backNavigation.register(dismiss);
    const outside = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest(`[data-record="${CSS.escape(record.record_id)}"]`)) dismiss(); };
    document.addEventListener('pointerdown', outside);
    return () => { unregister(); document.removeEventListener('pointerdown', outside); };
  }, [editing, displayReady, draft, drafts, record.record_id]);
  return <article className="saved-context-entry" data-record={record.record_id}>
    <section className="saved-context-copy">
      <div className="saved-record-top"><small>{record.source ? t('savedRecords.source', { name: record.source.file_name, index: record.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small><div className="saved-record-actions">
        <SourceAudioControls reference={record.source?.media} target={{ record_id: record.record_id }} text={record.sentence ?? ''} speechKey={`saved:${record.record_id}`}/>
        <button className="ui-button ui-button--icon" aria-label={t('savedRecords.returnToSource')} disabled={busy || sourceMissing} onClick={() => void returnToSource()}><ExternalLink size={17} /></button>
        <button className="ui-button ui-button--icon" aria-label={t('reader.personalExplanation')} disabled={busy || removing || editing} onClick={() => { if (!drafts.has(record.record_id)) expectedRevision.current = record.revision; drafts.set(record.record_id, updateSavedNoteDraft(drafts.get(record.record_id), draft, expectedRevision.current, true)); setEditing(true); }}><Pencil size={17} /></button>
        <button className="ui-button ui-button--icon" aria-label={t('dictionaryFlow.removeSentence')} disabled={busy || removing || editing} onClick={() => { setError(''); void onRemove(record).catch(reason => setError(t(savedErrorKey(reason)))); }}><Trash2 size={17} /></button>
      </div></div><p lang="en">{record.sentence || t('savedRecords.missingOriginal')}</p>
      {record.sentence_translation && <p>{record.sentence_translation}</p>}
      <small>{record.source?.document && [record.source.document.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : record.source.document.origin?.kind === 'webpage' ? record.source.document.origin.final_url : record.source.document.original_format.toUpperCase(), record.source.document.section_title, documentLocationLabel(record.source.document.locations[0])].filter(Boolean).join(' · ')}</small>
      <small className="saved-time">{record.saved_at === null ? t('savedRecords.unknownTime') : new Date(record.saved_at).toLocaleString(i18n.language)}</small>
    </section>
    <MotionChange changeKey={editing ? 'editing' : 'view'}>{editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={editorId}>{t('dictionaryFlow.personalMeaning')}</label>
      <textarea ref={editor} id={editorId} value={draft} onChange={event => { setDraft(event.target.value); drafts.set(record.record_id, updateSavedNoteDraft(drafts.get(record.record_id), event.target.value, expectedRevision.current, true)); }} autoFocus disabled={busy || removing} />
      <div className="saved-detail-actions"><button className="ui-button saved-primary" type="submit" disabled={busy || removing}>{t('savedRecords.saveChanges')}</button>
        <button className="ui-button" type="button" disabled={busy || removing} onClick={() => { setEditing(false); drafts.delete(record.record_id); setDraft(record.explanation_source === 'personal' ? record.explanation ?? '' : ''); pending.current = null; setError(''); }}>{t('common.cancel')}</button></div>
    </form> : record.explanation ? <section className="saved-context-meaning">
      <small className="saved-history-label">{record.explanation_source === 'personal' ? t('dictionaryFlow.personalMeaning') : `${t('dictionaryFlow.savedMeaning')} · ${t(`savedRecords.sources.${record.explanation_source}`)}`}</small>
      <p className="saved-detail-meaning">{record.explanation}</p>
    </section> : null}
    </MotionChange>
    {sourceMissing && <p className="saved-status" role="status">{t('savedRecords.sourceMissing')}</p>}
    {error && <p className="saved-error" role="alert">{error}</p>}
  </article>;
}

interface SavedGroupDetailProps {
  group: SavedGroup; revision: number; drafts: Map<string, EditDraft>; pendingRemove: string | null;
  undo: string | null; undoBusy: boolean; undoButton: RefObject<HTMLButtonElement | null>; onUndo: () => Promise<void>;
  onClose: () => void; onRemove: (record: SavedRecord) => Promise<void>; onReturn: (record: SavedRecord) => Promise<void>;
  initialCount: number; onCount: (count: number) => void; active: boolean;
}

function SavedGroupContent({ group, revision, drafts, pendingRemove, onRemove, onReturn, initialCount, onCount, active }: SavedGroupDetailProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<SavedContextPage>({ records: [], total: group.context_count });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const loadedCount = useRef(initialCount);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const load = useCallback(async (offset = 0) => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const target = offset ? CONTEXT_PAGE_SIZE : Math.max(CONTEXT_PAGE_SIZE, loadedCount.current);
      const batch = await readPaged(target, offset, 50, async (limit, start) => {
        const page = await invoke<SavedContextPage>('saved_group_contexts', { groupId: group.group_id, limit, offset: start });
        return {items: page.records, total: page.total};
      }, () => request.current === current);
      if (!batch) return;
      const next = {records: batch.items, total: batch.total};
      setPage(previous => ({ records: offset ? [...previous.records, ...next.records] : next.records, total: next.total }));
      loadedCount.current = offset + next.records.length; onCountRef.current(loadedCount.current);
    } catch { if (request.current === current) setError(t('savedRecords.loadError')); }
    finally { if (request.current === current) setLoading(false); }
  }, [group.group_id, t]);
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useLayoutEffect(() => { if (!active) invalidateRequest(); return invalidateRequest; }, [active, invalidateRequest]);
  useEffect(() => { if (!active) return; void load(); return invalidateRequest; }, [active, load, revision, retry, invalidateRequest]);

  return <>
    <div className="saved-detail-body saved-group-contexts" aria-busy={loading}>
      {loading && !page.records.length && <p className="saved-status" role="status">{t('common.loading')}</p>}
      {page.records.map(record => <SavedContext key={record.record_id} record={record} drafts={drafts} removing={pendingRemove !== null} displayReady={active} onRemove={onRemove} onReturn={onReturn} onChange={next => setPage(previous => ({ ...previous, records: previous.records.map(value => value.record_id === next.record_id ? next : value) }))} />)}
      {error && <div className="saved-error" role="alert"><p>{error}</p><button className="ui-button" onClick={() => setRetry(value => value + 1)} disabled={loading}>{t('common.retry')}</button></div>}
      {page.records.length < page.total && <button className="ui-button" disabled={loading} onClick={() => void load(page.records.length)}>{t('savedRecords.loadMore')}</button>}
    </div>

  </>;
}

export function SavedGroupCard({ group, selected, onOpen, children }: { group: SavedGroup; selected: boolean; onOpen: () => void; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const summary = (group as SavedGroup & { summary?: string | null }).summary;
  const id = `saved-panel-${group.group_id}`;
  return <li className="saved-record-row saved-group-row" data-group={group.group_id} data-expanded={selected}>
    <button className="saved-record-open" onClick={onOpen} aria-expanded={selected} aria-controls={id}>
      <span className="saved-record-term" lang="en">{group.expression}</span><span className="saved-context-count">{t('dictionaryFlow.contextCount', { count: group.context_count })}</span>
      {summary && <span className="saved-record-meaning">{summary}</span>}<ChevronRight className="saved-chevron" size={18} aria-hidden="true" />
    </button>
    <div id={id} className="saved-accordion" inert={!selected} aria-hidden={!selected}><div className="saved-accordion-clip">{children}</div></div>
  </li>;
}

export default function SavedPage() {
  const { t } = useTranslation();
  const importOpen = useImportStore(state => state.open);
  const location = useLocation();
  const navigate = useNavigate();
  const restoreToken = location.state?.restoreVisitToken;
  const restoreView = useRef(readerNavigation.get(restoreToken)?.origin);
  const snapshot = restoreView.current?.kind === 'saved' ? restoreView.current.view : undefined;
  const [query, setQuery] = useState(snapshot?.query ?? '');
  const [page, setPage] = useState<SavedGroupPage>({ groups: [], total_groups: 0, total_records: 0 });
  const [selected, setSelected] = useState<SavedGroup | null>(null);
  const [opened, setOpened] = useState<string[]>(snapshot?.expandedGroupId ? [snapshot.expandedGroupId] : []);
  const [loadedContexts, setLoadedContexts] = useState<Record<string, number>>({});
  const savedScroll = useRef<HTMLDivElement>(null);
  useQuietScrollbars(savedScroll, true);
  const livePage = useRef(true);
  const selectedRef = useRef<string | null>(null);
  const visitGeneration = useRef(0);
  const selectionIntent = useRef(0);
  useEffect(() => { visitGeneration.current++; }, [selected?.group_id]);
  selectedRef.current = selected?.group_id ?? null;
  useEffect(() => { livePage.current = true; return () => { livePage.current = false; }; }, []);
  const didRestore = useRef(false);
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
  const removedGroup = useRef<string | null>(null);
  const wantedGroup = useRef<string | null>(null);
  const loadedGroups = useRef(snapshot?.loadedGroups ?? PAGE_SIZE);
  const editDrafts = useRef(savedNoteDrafts);
  const liveView = useRef({ query, page, selected, loadedContexts });
  liveView.current = { query, page, selected, loadedContexts };
  const undoButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (importOpen) setSelected(null); }, [importOpen]);
  useEffect(() => { if (undo) undoButton.current?.focus({ preventScroll: true }); }, [undo, selected?.group_id]);
  const load = useCallback(async (offset = 0) => {
    const current = ++request.current;
    const intentAtStart = selectionIntent.current;
    setLoading(true); setError('');
    try {
      const target = offset ? PAGE_SIZE : Math.max(PAGE_SIZE, loadedGroups.current);
      let totals = {total_groups: 0, total_records: 0};
      const batch = await readPaged(target, offset, 200, async (limit, start) => {
        const page = await invoke<SavedGroupPage>('list_saved_groups', { query, limit, offset: start });
        totals = {total_groups: page.total_groups, total_records: page.total_records};
        return {items: page.groups, total: page.total_groups};
      }, () => current === request.current);
      if (!batch) return;
      const next = {...totals, groups: batch.items};
      setPage(previous => ({ ...next, groups: offset ? [...previous.groups, ...next.groups] : next.groups }));
      loadedGroups.current = offset + next.groups.length;
      // Capture the intent before the updater is queued; never let an older
      // request restore a group after the user has chosen another one.
      const wanted = wantedGroup.current;
      wantedGroup.current = null;
      const mayRestore = intentAtStart === selectionIntent.current;
      setSelected(previous => {
        const id = (mayRestore ? wanted : null) ?? previous?.group_id ?? (mayRestore && !didRestore.current ? snapshot?.expandedGroupId : null);
        return next.groups.find(group => group.group_id === id) ?? (offset ? previous : null);
      });
    } catch { if (current === request.current) setError(t('savedRecords.loadError')); }
    finally { if (current === request.current) setLoading(false); }
  }, [query, t, snapshot]);
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
  useLayoutEffect(() => {
    if (!snapshot || didRestore.current || loading || (snapshot.expandedGroupId && selected && !(snapshot.expandedGroupId in loadedContexts))) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        if (savedScroll.current) savedScroll.current.scrollTop = snapshot.scrollTop;
        const anchor = snapshot.anchor && savedScroll.current?.querySelector<HTMLElement>(`[data-record="${CSS.escape(snapshot.anchor.recordId)}"]`);
        if (anchor && savedScroll.current) savedScroll.current.scrollTop += anchor.getBoundingClientRect().top - savedScroll.current.getBoundingClientRect().top - snapshot.anchor!.offset;
        if (snapshot.focusRecordId) savedScroll.current?.querySelector<HTMLElement>(`[data-record="${CSS.escape(snapshot.focusRecordId)}"] .saved-record-actions button`)?.focus({preventScroll:true});
        didRestore.current = true; readerNavigation.complete(restoreToken);
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [snapshot, loading, loadedContexts, restoreToken, selected]);
  const returnToSource = async (record: SavedRecord) => {
    const groupId = selectedRef.current, generation = visitGeneration.current;
    const target = await resolveSavedSource(record);
    if (!livePage.current || selectedRef.current !== groupId || visitGeneration.current !== generation) return;
    if (!target) throw 'missing';
    const scroll = savedScroll.current;
    const row = scroll?.querySelector<HTMLElement>(`[data-record="${CSS.escape(record.record_id)}"]`);
    const current = liveView.current;
    const view: SavedViewSnapshot = { query: current.query, loadedGroups: current.page.groups.length, expandedGroupId: current.selected?.group_id ?? null, loadedContexts: current.loadedContexts, scrollTop: scroll?.scrollTop ?? 0,
      anchor: row && scroll ? { recordId: record.record_id, offset: row.getBoundingClientRect().top - scroll.getBoundingClientRect().top } : undefined, focusRecordId: record.record_id };
    const token = readerNavigation.create({kind:'saved', path:'/saved', view}, target);
    navigate(`/files/${target.fileId}?segment=${target.segmentIndex}`, {state:{sourceVisitToken:token}});
  };
  const contextCount = useCallback((groupId: string, count: number) => setLoadedContexts(current => current[groupId] === count ? current : {...current, [groupId]: count}), []);
  useEffect(() => {
    if (!selected) return;
    return backNavigation.setPage(() => { setSelected(null); return true; }, 2);
  }, [selected]);
  const remove = async (record: SavedRecord) => {
    if (pendingRemove || undoBusy) return;
    const key = `${record.record_id}:${record.revision}`;
    const operationId = removalReceipts.current.get(key) ?? crypto.randomUUID();
    removalReceipts.current.set(key, operationId);
    const removingGroup = selected?.group_id ?? null;
    setPendingRemove(record.record_id); setError('');
    try {
      const result = await mutateSaved({ kind: 'remove', record_id: record.record_id, expected_revision: record.revision }, operationId);
      if (result.changed) { removedGroup.current = removingGroup; setUndo(result.operation_id); if (selected?.context_count === 1) setSelected(current => current?.group_id === removingGroup ? null : current); }
      removalReceipts.current.delete(key);
    } catch (reason) { setError(t(savedErrorKey(reason))); throw reason; }
    finally { setPendingRemove(null); }
  };
  const restore = async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true); setError('');
    try { wantedGroup.current = removedGroup.current; await undoSaved(undo); await load(); setUndo(null); }
    catch (reason) { setError(t(savedErrorKey(reason))); }
    finally { setUndoBusy(false); }
  };
  return <div className="saved-page">
    <div className="saved-scroll" ref={savedScroll} onPointerDown={event => { if (event.target === event.currentTarget || event.target === event.currentTarget.firstElementChild) setSelected(null); }}><div className="saved-workspace workspace-paper">
      <div className="saved-heading"><h1>{t('savedRecords.title')}</h1><span role="status">{t('dictionaryFlow.groupCount', { count: page.total_groups, contexts: page.total_records })}</span></div>
      <label className="saved-search"><Search size={18} aria-hidden="true" /><span className="sr-only">{t('savedRecords.search')}</span><input type="search" value={query} onChange={event => { loadedGroups.current = PAGE_SIZE; setQuery(event.target.value); }} placeholder={t('savedRecords.search')} /></label>
      {error && <div className="saved-error" role="alert"><p>{error}</p><button className="ui-button" onClick={() => void load()}>{t('common.retry')}</button></div>}
      {loading && <p className="saved-status" role="status">{t('common.loading')}</p>}
      {!loading && !error && !page.groups.length && <div className="saved-empty"><Bookmark size={30} aria-hidden="true" /><p>{t(query ? 'savedRecords.noResults' : 'savedRecords.empty')}</p></div>}
      <MotionChange interruptKey={selected?.group_id ?? ''} changeKey={`${query}:${page.groups.map(group => `${group.group_id}:${group.context_count}`).join(',')}`}><ul className="saved-record-list" aria-label={t('savedRecords.title')}>
        {page.groups.map(group => <SavedGroupCard key={group.group_id} group={group} selected={selected?.group_id === group.group_id} onOpen={() => { selectionIntent.current++; setSelected(current => current?.group_id === group.group_id ? null : group); setOpened(current => current.includes(group.group_id) ? current : [...current, group.group_id]); }}>
          {opened.includes(group.group_id) && <SavedGroupContent active={selected?.group_id === group.group_id} group={group} revision={contextRevision} drafts={editDrafts.current} pendingRemove={pendingRemove} undo={undo} undoBusy={undoBusy} undoButton={undoButton} onUndo={restore} onClose={() => setSelected(null)} onRemove={remove} onReturn={returnToSource} initialCount={snapshot?.loadedContexts[group.group_id] ?? CONTEXT_PAGE_SIZE} onCount={count => contextCount(group.group_id, count)} />}
        </SavedGroupCard>)}
      </ul></MotionChange>
      {page.groups.length < page.total_groups && <button className="ui-button" disabled={loading} onClick={() => void load(page.groups.length)}>{t('savedRecords.loadMore')}</button>}
      {report && report.saved_contexts > 0 && <details className="saved-migration"><summary>{t('savedRecords.migrationTitle')}</summary><p>{t('savedRecords.migrationReport', { count: report.saved_contexts, missing: report.missing_sources })}</p></details>}
      {conflicts.length > 0 && <details className="saved-conflicts"><summary>{t('savedRecords.conflicts', { count: conflicts.length })}</summary><p>{t('savedRecords.conflictsHint')}</p>{conflicts.map(conflict => <section key={conflict.id}><h2>{conflict.local.expression}</h2><p>{t('savedRecords.localVersion')}：{conflict.local.explanation || t('savedRecords.noExplanation')}</p><p>{t('savedRecords.remoteVersion')}：{conflict.remote.explanation || t('savedRecords.noExplanation')}</p><p lang="en">{conflict.local.sentence}</p></section>)}</details>}
    </div></div>
    {undo && <div className="saved-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button ui-button--icon" aria-label={t('savedRecords.undo')} title={t('savedRecords.undo')} ref={undoButton} disabled={undoBusy || pendingRemove !== null} onClick={() => void restore()}><Undo2 size={20} aria-hidden="true" /></button></div>}

  </div>;
}
