import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Search, Undo2, X } from 'lucide-react';
import SavedArchiveIndex from '../components/SavedArchiveIndex';
import { SavedArchiveCard, SavedArchiveGloss } from '../components/SavedArchiveCard';
import { BusyRing } from '../components/LoadingFeedback';
import { useMediaQuery } from '../components/useMediaQuery';
import { useRestoreGuard } from '../stores/restoreGuard';
import { backNavigation } from '../lib/backNavigation';
import { createViewCache, usePageReturn, viewKey, visitState } from '../lib/pageNavigation';
import { readerNavigation, resolveSavedSource } from '../lib/readerNavigation';
import { finishSavedEntrance, prepareSavedReturn } from '../lib/savedEntrance';
import { dissolvePage } from '../lib/pageDissolve';
import { savedContextCache, savedGroupCache, useSavedReadRevision } from '../lib/savedReadCache';
import { mutateSaved, savedErrorKey, undoSaved, type SavedContextPage, type SavedGroup, type SavedGroupOrder, type SavedGroupPage, type SavedRecord } from '../lib/savedRecords';
import './source-return.css';
import './saved-archive.css';

const groupsPerPage = 200;
const contextsPerPage = 50;
const emptyGroups: SavedGroupPage = { groups: [], total_groups: 0, total_records: 0 };

type View = {
  query: string; order: SavedGroupOrder; group: SavedGroup | null; record: string | null;
  mobileDetail: boolean; listScroll: number; detailScroll: number;
};
const views = createViewCache<View>();
const groupCacheKey = (query: string, order: SavedGroupOrder, groupId: string | null, recordId: string | null) =>
  JSON.stringify([query, order, groupId, recordId]);
function readGroups(query: string, order: SavedGroupOrder, offset: number, groupId: string | null = null, recordId: string | null = null) {
  return invoke<SavedGroupPage>('list_saved_groups', {
    query, limit: groupsPerPage, offset, options: { order, focusGroupId: groupId, focusRecordId: recordId },
  });
}
function readContexts(groupId: string, offset: number) {
  return invoke<SavedContextPage>('saved_group_contexts', { groupId, limit: contextsPerPage, offset });
}

export default function SavedArchivePage() {
  const { t } = useTranslation();
  const location = useLocation(), navigate = useNavigate(), key = viewKey(location);
  const { back } = usePageReturn('/files');
  const phone = useMediaQuery('(max-width: 767px)');
  const generation = useRestoreGuard(s => s.generation);
  const savedRevision = useSavedReadRevision();
  const pocketRecord = (location.state as { pocketRecordId?: string } | null)?.pocketRecordId ?? null;
  const [initial] = useState(() => views.get(key));
  const [query, setQuery] = useState(initial?.query ?? '');
  const [searching, setSearching] = useState(Boolean(initial?.query));
  const [order, setOrder] = useState<SavedGroupOrder>(initial?.order ?? 'count');
  const [mobileDetail, setMobileDetail] = useState(initial?.mobileDetail ?? false);
  const [selected, setSelected] = useState<SavedGroup | null>(initial?.group ?? null);
  const [recordId, setRecordId] = useState<string | null>(initial?.record ?? pocketRecord);
  const [groupRead, setGroupRead] = useState<{ key: string; page: SavedGroupPage } | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupError, setGroupError] = useState(false);
  const [moreGroups, setMoreGroups] = useState(false);
  const [groupRetry, setGroupRetry] = useState(0);
  const [contextRead, setContextRead] = useState<{ identity: string; page: SavedContextPage } | null>(null);
  const [contextError, setContextError] = useState(false);
  const [moreContexts, setMoreContexts] = useState(false);
  const [contextRetry, setContextRetry] = useState(0);
  const [opening, setOpening] = useState<SavedRecord | null>(null);
  const [sourceBusy, setSourceBusy] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const list = useRef<HTMLDivElement>(null), detail = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const groupRequest = useRef(0), contextRequest = useRef(0), sourceRequest = useRef(0);
  const groupPaging = useRef<number | null>(null), contextPaging = useRef<number | null>(null);
  const pendingWrite = useRef(false), sourcePending = useRef(false);
  const restoredGroup = useRef(initial?.group?.group_id ?? null);
  const removeIntents = useRef(new Map<string, { operation: string; revision: string }>());
  const state = useRef<View>({
    query, order, group: selected, record: recordId, mobileDetail,
    listScroll: initial?.listScroll ?? 0, detailScroll: initial?.detailScroll ?? 0,
  });
  Object.assign(state.current, { query, order, group: selected, record: recordId, mobileDetail });

  const groupId = selected?.group_id ?? null;
  const showDetail = !phone || mobileDetail;
  const searchExpanded = phone && searching && !mobileDetail;
  const filter = JSON.stringify([query, order]);
  const groupPage = groupRead?.key === filter ? groupRead.page : emptyGroups;
  const identity = JSON.stringify([groupId, savedRevision, generation, contextRetry]);
  const contextPage = contextRead?.identity === identity ? contextRead.page : null;
  const hasContextPage = contextPage !== null;
  const openingRecord = showDetail && !query && !contextPage && opening?.record_id === recordId ? opening : null;
  const records = contextPage?.records ?? (openingRecord ? [openingRecord] : []);
  const record = records.find(item => item.record_id === recordId) ?? records[0];
  const heading = selected?.expression ?? openingRecord?.expression;

  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'manage') {
      navigate('/saved', { replace: true, state: location.state });
    }
  }, [location.search, location.state, navigate]);
  useEffect(() => {
    const snapshot = state.current;
    return () => { views.set(key, snapshot); sourceRequest.current++; };
  }, [key]);
  useEffect(() => {
    if (searching && !mobileDetail) search.current?.focus();
  }, [searching, mobileDetail]);

  useEffect(() => {
    if (!showDetail || !pocketRecord || initial || query) return;
    let current = true;
    void invoke<SavedRecord | null>('saved_opening_context', { recordId: pocketRecord }).then(value => {
      if (current) setOpening(value);
    }).catch(() => { /* Group and context reads report their own failures. */ });
    return () => { current = false; };
  }, [initial, pocketRecord, query, showDetail]);

  useEffect(() => {
    const token = ++groupRequest.current;
    const preferredGroup = state.current.group?.group_id ?? null;
    const preferredRecord = !preferredGroup && state.current.record === pocketRecord ? pocketRecord : null;
    const cache = groupCacheKey(query, order, preferredGroup, preferredRecord);
    const cached = savedGroupCache.peek(cache);
    setGroupRead(cached ? { key: filter, page: cached } : null);
    setGroupsLoading(!cached);
    setGroupError(false);
    setMoreGroups(false);
    const load = () => void savedGroupCache.fetch(cache, () => readGroups(query, order, 0, preferredGroup, preferredRecord)).then(page => {
      if (token !== groupRequest.current) return;
      setGroupRead({ key: filter, page });
      setSelected(previous => page.groups.find(item => item.group_id === previous?.group_id) ?? page.focused_group ?? page.groups[0] ?? null);
      if (!page.total_groups) setMobileDetail(false);
      setGroupsLoading(false);
    }).catch(() => {
      if (token === groupRequest.current) { setGroupError(true); setGroupsLoading(false); }
    });
    const timer = query && !cached ? setTimeout(load, 160) : undefined;
    if (timer === undefined) load();
    return () => { clearTimeout(timer); if (groupRequest.current === token) groupRequest.current = token + 1; };
  }, [filter, generation, groupRetry, order, pocketRecord, query, savedRevision]);

  useEffect(() => {
    const token = ++contextRequest.current;
    setContextError(false);
    setMoreContexts(false);
    if (!showDetail || !groupId) return;
    const cached = savedContextCache.peek(groupId);
    if (cached) setContextRead({ identity, page: cached });
    void savedContextCache.fetch(groupId, () => readContexts(groupId, 0)).then(page => {
      if (token !== contextRequest.current) return;
      setContextRead({ identity, page });
      setRecordId(previous => page.records.some(item => item.record_id === previous)
        ? previous : page.records[0]?.record_id ?? null);
    }).catch(() => { if (token === contextRequest.current) setContextError(true); });
    return () => { contextRequest.current++; };
  }, [groupId, identity, showDetail]);

  useLayoutEffect(() => {
    if (!groupsLoading && list.current && (!phone || !mobileDetail)) list.current.scrollTop = state.current.listScroll;
  }, [groupsLoading, mobileDetail, phone]);
  useLayoutEffect(() => {
    if (restoredGroup.current !== groupId) {
      restoredGroup.current = groupId;
      state.current.detailScroll = 0;
    }
    if (showDetail && detail.current) detail.current.scrollTop = state.current.detailScroll;
  }, [groupId, hasContextPage, showDetail]);
  useLayoutEffect(() => {
    if (record && showDetail) finishSavedEntrance(record.record_id);
  }, [record, showDetail]);

  const leave = useCallback(() => {
    if (!phone && prepareSavedReturn(record?.record_id)) back();
    else dissolvePage(back, true);
  }, [back, phone, record?.record_id]);
  const cancelSource = useCallback(() => {
    sourceRequest.current++;
    sourcePending.current = false;
    setSourceBusy(null);
    setSourceError('');
  }, []);
  const goBack = useCallback(() => {
    if (phone && mobileDetail) {
      cancelSource();
      setMobileDetail(false);
      requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('.approved-saved-word[aria-pressed="true"]')?.focus({ preventScroll: true }));
    } else leave();
  }, [cancelSource, leave, mobileDetail, phone]);
  useEffect(() => backNavigation.setPage(() => { goBack(); return true; }, 3), [goBack]);
  useEffect(() => {
    if (!phone || !mobileDetail) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || backNavigation.hasLayers()) return;
      event.preventDefault();
      goBack();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [goBack, mobileDetail, phone]);

  const select = (group: SavedGroup, open: boolean) => {
    if (group.group_id !== groupId) {
      cancelSource();
      state.current.detailScroll = 0;
      setRecordId(null);
      setSelected(group);
    }
    if (phone && open) {
      state.current.listScroll = list.current?.scrollTop ?? 0;
      setMobileDetail(true);
    }
  };
  const changeOrder = (next: SavedGroupOrder) => {
    if (next === order) return;
    state.current.listScroll = 0;
    if (list.current) list.current.scrollTop = 0;
    setOrder(next);
  };
  const changeQuery = (value: string) => {
    cancelSource();
    state.current.listScroll = 0;
    if (list.current) list.current.scrollTop = 0;
    setQuery(value);
  };
  const toggleSearch = () => {
    if (!phone) { search.current?.focus(); return; }
    if (searchExpanded) { changeQuery(''); setSearching(false); }
    else { cancelSource(); setMobileDetail(false); setSearching(true); }
  };

  const rememberGroups = (page: SavedGroupPage) => {
    savedGroupCache.prime(groupCacheKey(query, order, groupId, null), {
      ...page, focused_group: selected ?? undefined,
    });
  };
  const loadMoreGroups = async () => {
    const token = groupRequest.current;
    if (groupsLoading || !groupRead || groupRead.key !== filter || groupPaging.current === token) return;
    groupPaging.current = token;
    setMoreGroups(true);
    try {
      const page = await readGroups(query, order, groupPage.groups.length);
      if (token !== groupRequest.current) return;
      const combined = { ...page, groups: [...groupPage.groups, ...page.groups] };
      setGroupRead({ key: filter, page: combined });
      rememberGroups(combined);
    } catch { if (token === groupRequest.current) setGroupError(true); }
    finally {
      if (groupPaging.current === token) groupPaging.current = null;
      if (token === groupRequest.current) setMoreGroups(false);
    }
  };
  const loadMoreContexts = async () => {
    const token = contextRequest.current;
    if (!groupId || !contextPage || contextPaging.current === token) return;
    contextPaging.current = token;
    setMoreContexts(true);
    setSourceError('');
    try {
      const page = await readContexts(groupId, contextPage.records.length);
      if (token !== contextRequest.current) return;
      const combined = { ...page, records: [...contextPage.records, ...page.records] };
      savedContextCache.prime(groupId, combined);
      setContextRead({ identity, page: combined });
    } catch { if (token === contextRequest.current) setSourceError('savedRecords.loadError'); }
    finally {
      if (contextPaging.current === token) contextPaging.current = null;
      if (token === contextRequest.current) setMoreContexts(false);
    }
  };

  const openSource = async (item: SavedRecord) => {
    if (sourcePending.current) return;
    const token = ++sourceRequest.current;
    sourcePending.current = true;
    setSourceBusy(item.record_id);
    setSourceError('');
    setRecordId(item.record_id);
    try {
      const target = await resolveSavedSource(item);
      if (token !== sourceRequest.current) return;
      if (!target) { setSourceError('savedRecords.sourceMissing'); return; }
      rememberGroups(groupPage);
      state.current.record = item.record_id;
      state.current.detailScroll = detail.current?.scrollTop ?? state.current.detailScroll;
      views.set(key, state.current);
      const visit = readerNavigation.create({
        kind: 'saved', path: '/saved', view: {
          query, loadedGroups: groupPage.groups.length, expandedGroupId: groupId,
          loadedContexts: groupId ? { [groupId]: records.length } : {},
          scrollTop: state.current.listScroll, focusRecordId: item.record_id,
        },
      }, target);
      navigate(`/files/${target.fileId}?segment=${target.segmentIndex}`, { state: { ...visitState(location), sourceVisitToken: visit } });
    } catch { if (token === sourceRequest.current) setSourceError('savedRecords.sourceError'); }
    finally {
      if (token === sourceRequest.current) { sourcePending.current = false; setSourceBusy(null); }
    }
  };
  const remove = async (item: SavedRecord) => {
    if (pendingWrite.current) return false;
    const intent = removeIntents.current.get(item.record_id) ?? { operation: crypto.randomUUID(), revision: item.revision };
    removeIntents.current.set(item.record_id, intent);
    pendingWrite.current = true;
    setWriting(true);
    try {
      await mutateSaved({ kind: 'remove', record_id: item.record_id, expected_revision: intent.revision }, intent.operation);
      setReceipt(intent.operation);
      setContextRead(previous => previous?.identity === identity ? {
        identity, page: { records: previous.page.records.filter(saved => saved.record_id !== item.record_id), total: Math.max(0, previous.page.total - 1) },
      } : previous);
      removeIntents.current.delete(item.record_id);
      return true;
    } catch (error) { setSourceError(savedErrorKey(error)); return false; }
    finally { pendingWrite.current = false; setWriting(false); }
  };
  const undo = async () => {
    if (!receipt || pendingWrite.current) return;
    pendingWrite.current = true;
    setWriting(true);
    try { await undoSaved(receipt); setReceipt(null); }
    catch (error) { setSourceError(savedErrorKey(error)); }
    finally { pendingWrite.current = false; setWriting(false); }
  };

  const searchToggle = <button key="toggle" type="button" className="approved-icon"
    aria-label={t(searchExpanded ? 'common.close' : 'savedRecords.search')}
    aria-expanded={phone ? searchExpanded : undefined} onClick={toggleSearch}>
    {searchExpanded ? <X size={20} aria-hidden="true"/> : <Search size={20} strokeWidth={1.65} aria-hidden="true"/>}
  </button>;
  const searchField = <div key="field" className="approved-saved-search-field">
    <input ref={search} type="search" aria-label={t('savedRecords.search')} placeholder={t('savedRecords.search')} value={query}
      onChange={event => changeQuery(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (query) changeQuery('');
        else { setSearching(false); search.current?.blur(); }
      }}/>
  </div>;

  return <section className="approved-saved saved-workspace" aria-labelledby="saved-archive-title" data-mobile-detail={mobileDetail} data-searching={searching}>
    <header className="approved-saved-header">
      <div className="saved-archive-heading">
        <button type="button" className="approved-icon approved-back" aria-label={t('common.back')} onClick={goBack}><ArrowLeft size={21} strokeWidth={1.65}/></button>
        <h1 id="saved-archive-title">{t('savedRecords.archiveTitle')}</h1>
      </div>
      <div className="approved-saved-search" data-expanded={searchExpanded}>
        {searchExpanded ? [
          <span key="glyph" className="approved-saved-search-glyph" aria-hidden="true"><Search size={20} strokeWidth={1.65}/></span>,
          searchField,
          searchToggle,
        ] : [searchToggle, searchField]}
      </div>
    </header>
    <div className="approved-saved-columns">
      <SavedArchiveIndex
        groups={groupPage.groups} order={order} selected={groupId} loading={groupsLoading} error={groupError}
        loadingMore={moreGroups} hasMore={groupPage.groups.length < groupPage.total_groups} query={query} listRef={list}
        onOrderChange={changeOrder} onChoose={group => select(group, true)} onPreview={group => { if (!phone) select(group, false); }}
        onMore={() => void loadMoreGroups()} onRetry={() => setGroupRetry(retry => retry + 1)}
        onScroll={event => { state.current.listScroll = event.currentTarget.scrollTop; }}
      />
      {showDetail && <div className="approved-saved-detail" aria-label={t('savedRecords.context')}>
        {heading && <header className="saved-archive-term">
          <h2 lang="en">{heading}</h2>
          {record && <SavedArchiveGloss record={record} summary={selected?.summary}/>}
        </header>}
        <div ref={detail} className="approved-folio-scroll" onScroll={event => { state.current.detailScroll = event.currentTarget.scrollTop; }}>
          {records.map(item => <SavedArchiveCard key={item.record_id} record={item} current={record?.record_id === item.record_id}
            sourceBusy={sourceBusy !== null} removing={writing} onSource={() => void openSource(item)} onRemove={() => remove(item)}
            onActivate={() => setRecordId(item.record_id)}/>)}
          {contextPage && contextPage.records.length < contextPage.total && <button className="saved-archive-action" type="button" disabled={moreContexts} onClick={() => void loadMoreContexts()}>{t(moreContexts ? 'common.loading' : 'savedRecords.loadMore')}</button>}
          {(contextError || (phone && groupError)) && <div className="saved-archive-status" role="alert">
            <p>{t('savedRecords.loadError')}</p><button type="button" className="saved-archive-action" onClick={() => {
              if (groupError) setGroupRetry(retry => retry + 1);
              if (contextError) setContextRetry(retry => retry + 1);
            }}>{t('common.retry')}</button>
          </div>}
          {!records.length && !contextError && !groupError && (groupsLoading || (groupId && !contextPage)) && <div className="saved-archive-status" role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></div>}
        </div>
        {sourceError && <p className="saved-error" role="alert">{t(sourceError)}</p>}
      </div>}
    </div>
    {receipt && <div className="recall-undo" role="status"><span>{t('savedRecords.removed')}</span><button type="button" className="saved-archive-action" disabled={writing} onClick={() => void undo()}><Undo2 size={18}/>{t('savedRecords.undo')}</button></div>}
  </section>;
}
