import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Check, SkipForward, Undo2 } from 'lucide-react';
import type { AnnotationIdentity, AnnotationMode, AnnotationScope } from '../lib/annotation';
import { annotationItems, annotationKey, annotationShortcut, annotationStats } from '../lib/annotation';
import type { PhraseDetail, PhraseInfo, WordDetail, WordInfo, WordStatus } from '../lib/types';
import { occurrenceRoute } from '../lib/fileProgress';
import { useAnnotationStore } from '../stores/annotationStore';
import { useWordStore } from '../stores/wordStore';
import { usePhraseStore } from '../stores/phraseStore';
import AnnotationModeSwitch from './AnnotationModeSwitch';
import AnnotationCard from './AnnotationCard';
import DisplaySettingsMenu from './DisplaySettingsMenu';
import WordDetailPanel from './WordDetail';
import PhraseDetailPanel from './PhraseDetail';

export default function AnnotationWorkspace({ scope, items, loading, onModeChange }: {
  scope: AnnotationScope; items: AnnotationIdentity[]; loading: boolean; onModeChange: (mode: AnnotationMode) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = annotationKey(scope.kind, scope.language);
  const session = useAnnotationStore(state => state.sessions[key]);
  const sessionBusy = useAnnotationStore(state => !!state.busy[key]);
  const sessionError = useAnnotationStore(state => state.errors[key]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const busy = sessionBusy || starting;
  const error = sessionError || startError;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ identity: string; detail: WordDetail | PhraseDetail | null; error: boolean } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [revision, setRevision] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const current = activeId === session?.id ? session?.items[session.index] : undefined;
  const active = activeId === session?.id && !!session;
  const identity = current ? JSON.stringify([session?.id, current.id, current.term, current.language, revision]) : '';
  const detail = loaded?.identity === identity ? loaded.detail : null;
  const detailLoading = !!current && loaded?.identity !== identity;
  const detailError = loaded?.identity === identity && loaded.error;
  const actions = useAnnotationStore.getState();
  const blocked = busy || !!session?.pending;
  const stats = session ? annotationStats(session) : null;

  useEffect(() => {
    let valid = true;
    const request = ++requestGeneration.current;
    scrollRef.current?.scrollTo({ top: 0 });
    if (!current) return;
    void (async () => {
      try {
        const next = await invoke<WordDetail | PhraseDetail>(scope.kind === 'word' ? 'word_detail' : 'phrase_detail', scope.kind === 'word' ? { wordId: current.id } : { phraseId: current.id });
        const item = 'word' in next ? next.word : next.phrase;
        const term = 'lemma' in item ? item.lemma : item.text;
        if (item.id !== current.id || term !== current.term || item.language !== current.language) throw new Error('identity changed');
        if (valid && request === requestGeneration.current) setLoaded({ identity, detail: next, error: false });
      } catch { if (valid && request === requestGeneration.current) setLoaded({ identity, detail: null, error: true }); }
    })();
    return () => { valid = false; requestGeneration.current += 1; };
  }, [current, scope.kind, identity]);

  const resume = async () => {
    setStartError('');
    if (await useAnnotationStore.getState().resume(key)) {
      setActiveId(useAnnotationStore.getState().sessions[key].id);
      setRevision(value => value + 1);
    }
  };
  const start = async () => {
    if (loading || blocked) return;
    setStarting(true); setStartError('');
    try {
      // Read fresh results so a completed item cannot re-enter through a stale list cache.
      const fresh = await invoke<(WordInfo | PhraseInfo)[]>(scope.kind === 'word' ? 'list_words' : 'list_phrases', {
        statusFilter: scope.filter === 'all' ? null : scope.filter, sortBy: scope.sortBy,
        language: scope.language === 'all' ? null : scope.language,
        ...(scope.kind === 'word' ? { includeProperNouns: scope.includeProperNouns } : { includeUnverified: scope.includeUnverified }),
      });
      actions.start(scope, annotationItems(fresh, scope.query));
      setActiveId(useAnnotationStore.getState().sessions[key]?.id ?? null);
    } catch (e) { setStartError(String(e)); }
    finally { setStarting(false); }
  };
  const rate = (status: WordStatus) => {
    if (!detail || drawer || blocked || (status === 'unprocessed' && ('word' in detail ? detail.word.status : detail.phrase.status) === 'unprocessed')) return;
    void actions.submit(key, status);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = !!target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
      const status = annotationShortcut(event, editable, !active || drawer || blocked || !detail || detailLoading);
      if (status && detail && !(status === 'unprocessed' && ('word' in detail ? detail.word.status : detail.phrase.status) === 'unprocessed')) {
        event.preventDefault(); void useAnnotationStore.getState().submit(key, status);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, drawer, blocked, detail, detailLoading, key]);

  const closeDrawer = () => { requestGeneration.current += 1; setDrawer(false); setRevision(value => value + 1); };
  const reloadDetail = async () => {
    if (!current) return;
    const request = ++requestGeneration.current;
    const next = await invoke<WordDetail | PhraseDetail>(scope.kind === 'word' ? 'word_detail' : 'phrase_detail', scope.kind === 'word' ? { wordId: current.id } : { phraseId: current.id });
    if (request === requestGeneration.current) setLoaded({ identity, detail: next, error: false });
  };
  const changeStatus = async (id: number, status: WordStatus) => {
    if (scope.kind === 'word') await useWordStore.getState().updateStatus(id, status);
    else await usePhraseStore.getState().updateStatus(id, status);
    await reloadDetail();
  };
  const saveDefinition = async (id: number, definition: string) => {
    if (scope.kind === 'word') await useWordStore.getState().updateDefinition(id, definition);
    else await usePhraseStore.getState().updateDefinition(id, definition);
    await reloadDetail();
  };
  const range = active && session ? session.scope : scope;
  const currentStatus = detail && ('word' in detail ? detail.word.status : detail.phrase.status);
  return <div className="annotation-workspace">
    <header className="annotation-header">
      <div className="annotation-header__row"><h1>{t(scope.kind === 'word' ? 'words.title' : 'phrases.title')}</h1><DisplaySettingsMenu /></div>
      <div className="annotation-header__row"><AnnotationModeSwitch mode="single" onChange={onModeChange} disabled={busy} /><button type="button" className="ui-button" disabled={busy} onClick={() => onModeChange('batch')}>{t('annotation.adjustRange')}</button></div>
      <p className="annotation-range">{t('annotation.range', { language: range.language === 'all' ? t('common.all') : range.language.toUpperCase(), filter: t(range.filter === 'all' ? 'common.all' : range.filter === 'ignored' ? 'annotation.ignore' : `status.${range.filter}`), sort: t(`sort.${range.sortBy}`) })}{range.query && ` · “${range.query}”`}{range.includeProperNouns && ` · ${t('words.showProperNouns')}`}{range.includeUnverified && ` · ${t('phrases.showUnverified')}`}</p>
    </header>
    <div className="annotation-scroll" ref={scrollRef}>
      <div className="annotation-content">
        {error && <div className="annotation-error" role="alert"><p>{t(error.includes('annotation_conflict') || error.includes('annotation_identity_changed') ? 'annotation.conflict' : 'annotation.operationFailed')}</p>
          <div className="annotation-inline-actions">{session?.pending && <button type="button" className="ui-button" disabled={busy} onClick={() => void actions.retry(key)}>{t('common.retry')}</button>}<button type="button" className="ui-button" disabled={busy} onClick={() => void resume()}>{t('annotation.reconcile')}</button></div>
        </div>}
        {!active ? <div className="annotation-start">
          <h2>{t(session ? 'annotation.resumeTitle' : 'annotation.startTitle')}</h2>
          <p className="annotation-muted">{session ? t('annotation.resumeDescription', { current: session.index, total: session.items.length }) : t('annotation.startDescription', { count: items.length })}</p>
          <div className="annotation-inline-actions">
            {session && <button type="button" className="ui-button" disabled={busy} onClick={() => void resume()}>{busy ? t('common.loading') : t('annotation.continue')}</button>}
            <button type="button" className="ui-button" disabled={loading || blocked || !items.length} onClick={start}>{loading ? t('common.loading') : t(session ? 'annotation.newRound' : 'annotation.start', { count: items.length })}</button>
          </div>
          {!loading && !items.length && <p className="annotation-muted">{t('annotation.noResults')}</p>}
        </div> : <>
          <div className="annotation-progress" aria-live="polite"><span>{t('annotation.progress', { current: session.index, total: session.items.length })}</span><span>{t('annotation.skippedCount', { count: stats!.skipped })}</span><progress value={session.index} max={Math.max(1, session.items.length)} aria-label={t('annotation.progress', { current: session.index, total: session.items.length })} /></div>
          {current ? <>
            {detailLoading && <div className="annotation-start" role="status">{t('common.loading')}</div>}
            {detailError && <div className="annotation-start" role="alert"><p>{t('errors.detailLoadFailed')}</p><button type="button" className="ui-button" disabled={busy} onClick={() => void resume()}>{t('common.retry')}</button></div>}
            {detail && <AnnotationCard key={`${session.id}:${current.id}:${revision}`} detail={detail} onDetail={() => { if (!blocked) setDrawer(true); }} onOccurrence={occ => navigate(occurrenceRoute(occ, scope.kind, current.id))} />}
          </> : <div className="annotation-start">
            <Check size={36} aria-hidden="true" /><h2>{t('annotation.completed')}</h2>
            <div className="annotation-stats">{(['learning', 'known', 'ignored', 'unprocessed', 'skipped'] as const).map(status => <div key={status}><strong>{stats![status]}</strong><span>{t(status === 'skipped' ? 'annotation.skipped' : status === 'ignored' ? 'annotation.ignore' : `status.${status}`)}</span></div>)}</div>
            <div className="annotation-inline-actions"><button type="button" className="ui-button" disabled={blocked || !stats!.skipped} onClick={() => { actions.reviewSkipped(key); setActiveId(useAnnotationStore.getState().sessions[key].id); }}>{t('annotation.reviewSkipped')}</button><button type="button" className="ui-button" disabled={loading || blocked || !items.length} onClick={start}>{t('annotation.newRound')}</button><button type="button" className="ui-button" disabled={busy} onClick={() => onModeChange('batch')}>{t('annotation.backToBatch')}</button></div>
          </div>}
        </>}
      </div>
    </div>
    {active && <footer className="annotation-footer">
      <div className="annotation-actions">
        {current && (['learning', 'known', 'ignored'] as const).map((status, index) => <button type="button" className="ui-button annotation-status" data-status={status} key={status} disabled={blocked || !detail || drawer || detailLoading} onClick={() => rate(status)}>{t(status === 'ignored' ? 'annotation.ignore' : `status.${status}`)}<kbd>{index + 1}</kbd></button>)}
        {current && currentStatus && currentStatus !== 'unprocessed' && <button type="button" className="ui-button" disabled={blocked || drawer || detailLoading} onClick={() => rate('unprocessed')}>{t('status.unprocessed')}<kbd>0</kbd></button>}
        {current && <button type="button" className="ui-button" disabled={blocked || drawer || detailLoading || !detail} onClick={() => actions.skip(key)}><SkipForward size={16} aria-hidden="true" />{t('annotation.skip')}</button>}
        <button type="button" className="ui-button" disabled={blocked || drawer || !session.lastStep} onClick={() => void actions.undo(key)}><Undo2 size={16} aria-hidden="true" />{t('annotation.undo')}</button>
      </div>
      {busy && <p role="status" className="annotation-muted">{t('words.processing')}</p>}
    </footer>}
    {drawer && detail && <><div className="fixed inset-0 bg-black/20 z-30" onClick={closeDrawer} />{'word' in detail ? <WordDetailPanel detail={detail} onClose={closeDrawer} onStatusChange={changeStatus} onDefinitionSave={saveDefinition} onWordResolved={() => { closeDrawer(); void resume(); }} onOccurrenceOpen={occ => { closeDrawer(); navigate(occurrenceRoute(occ, 'word', detail.word.id)); }} /> : <PhraseDetailPanel detail={detail} onClose={closeDrawer} onStatusChange={changeStatus} onDefinitionSave={saveDefinition} onOccurrenceOpen={occ => { closeDrawer(); navigate(occurrenceRoute(occ, 'phrase', detail.phrase.id)); }} />}</>}
  </div>;
}
