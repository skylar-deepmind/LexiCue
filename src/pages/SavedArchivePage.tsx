import useTrashDrag, { isTrashDragging } from '../components/useTrashDrag';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import SavedTimeline from '../components/SavedTimeline';
import '../components/saved-timeline.css';
import SavedExcerpt from '../components/SavedExcerpt';
import { finishSavedEntrance, prepareSavedReturn } from '../lib/savedEntrance';
import { dissolvePage } from '../lib/pageDissolve';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronLeft, ChevronRight, Search, Undo2, Volume2 } from 'lucide-react';
import { createViewCache, usePageReturn, viewKey, visitState } from '../lib/pageNavigation';
import { backNavigation } from '../lib/backNavigation';
import { readerNavigation, resolveSavedSource, savedNoteDrafts } from '../lib/readerNavigation';
import { mutateSaved, savedErrorKey, undoSaved, type SavedContextPage, type SavedGroupPage, type SavedRecord } from '../lib/savedRecords';
import { savedCover } from '../lib/materialCover';
import { useRestoreGuard } from '../stores/restoreGuard';
import MaterialCover from '../components/MaterialCover';
import SpeechButton, { SpeechFeedback } from '../components/SpeechButton';
import { BusyRing } from '../components/LoadingFeedback';
import { bindMediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import './source-return.css';

type View = { query: string; start: string; end: string; selected: string | null; record: string | null; expanded: boolean; listScroll: number };
const views = createViewCache<View>();
function bounds(start: string, end: string) {
  const first = start ? new Date(`${start}T00:00:00`).getTime() : null;
  const last = end ? new Date(`${end}T00:00:00`) : null;
  if (last) last.setDate(last.getDate() + 1);
  return { startMs: first, endMs: last?.getTime() ?? null };
}
export default function SavedArchivePage() {
  return <SavedArchive/>;
}
function SavedArchive() {
  const { t } = useTranslation(), location = useLocation(), navigate = useNavigate(), key = viewKey(location);
  useEffect(()=>{if(new URLSearchParams(location.search).get('view')==='manage')navigate('/saved',{replace:true,state:location.state});},[location.search,navigate,location.state]);
  const { back } = usePageReturn('/files');
  const generation = useRestoreGuard(s => s.generation);
  const pocketRecordId = (location.state as {pocketRecordId?:string}|null)?.pocketRecordId;
  const [initial] = useState(() => views.get(key));
  const [query, setQuery] = useState(initial?.query ?? ''), [searching, setSearching] = useState(!!initial?.query);
  const [start, setStart] = useState(initial?.start ?? ''), [end, setEnd] = useState(initial?.end ?? '');
  const [selected, setSelected] = useState<string | null>(initial?.selected ?? null), [recordId, setRecordId] = useState<string | null>(initial?.record ?? pocketRecordId ?? null);
  const [expanded, setExpanded] = useState(initial?.expanded ?? false);
  const [groups, setGroups] = useState<SavedGroupPage>({ groups: [], total_groups: 0, total_records: 0 });
  const [contexts, setContexts] = useState<SavedContextPage>({ records: [], total: 0 });
  const [timelineStatus, setTimelineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bins, setBins] = useState<{ day: number; count: number }[]>([]);
  const [loading, setLoading] = useState(true), [contextLoading, setContextLoading] = useState(false), [failure, setFailure] = useState(false), [revision, setRevision] = useState(0);
  const [sourceBusy, setSourceBusy] = useState(false), [sourceError, setSourceError] = useState('');
  const removeIntents = useRef(new Map<string, { operation: string; revision: string }>());
  const [receipt, setReceipt] = useState<string | null>(null), [undoing, setUndoing] = useState(false);
  const [direction, setDirection] = useState(1);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), detail = useRef<HTMLDivElement>(null);
  const request = useRef(0), contextRequest = useRef(0), sourceRequest = useRef(0), alive = useRef(true);
  const gesture = useRef<{ x: number; y: number; direction: 'x' | 'y' | null } | null>(null), suppress = useRef(0);
  const snapshot = useRef<View>({ query, start, end, selected, record: recordId, expanded, listScroll: initial?.listScroll ?? 0 });
  snapshot.current = { query, start, end, selected, record: recordId, expanded, listScroll: list.current?.scrollTop ?? initial?.listScroll ?? 0 };
  useEffect(() => () => { views.set(key, snapshot.current); }, [key]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sourceRequest.current++; }; }, []);
  useEffect(() => { if (searching) input.current?.focus(); }, [searching]);
  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('lexicue-saved-changed', changed); window.addEventListener('lexicue-sync-applied', changed);
    return () => { window.removeEventListener('lexicue-saved-changed', changed); window.removeEventListener('lexicue-sync-applied', changed); };
  }, []);
  useEffect(() => {
    let current = true;
    setTimelineStatus('loading');
    void invoke<typeof bins>('saved_date_histogram', { offsetMinutes: new Date().getTimezoneOffset() }).then(value => { if (current) { setBins(value); setTimelineStatus('ready'); } }).catch(() => { if (current) setTimelineStatus('error'); });
    return () => { current = false; };
  }, [revision, generation]);
  useEffect(() => {
    const token = ++request.current; setLoading(true); setFailure(false);
    const timer = setTimeout(() => {
      void invoke<SavedGroupPage>('list_saved_groups', { query, limit: 200, offset: 0, ...bounds(start, end) }).then(next => {
        if (token !== request.current) return;
        setGroups(next); setSelected(previous => next.groups.some(group => group.group_id === previous) ? previous : next.groups.find(group=>group.preview.record_id===pocketRecordId)?.group_id ?? next.groups[0]?.group_id ?? null); setLoading(false);
      }).catch(() => { if (token === request.current) { setFailure(true); setLoading(false); } });
    }, query ? 160 : 0);
    return () => { clearTimeout(timer); request.current++; };
  }, [query, start, end, revision, generation, pocketRecordId]);
  useEffect(() => {
    const token = ++contextRequest.current; sourceRequest.current++; setSourceError(''); setSourceBusy(false);
    if (!selected) { setContexts({ records: [], total: 0 }); return; }
    setContextLoading(true);
    void invoke<SavedContextPage>('saved_group_contexts', { groupId: selected, limit: 50, offset: 0, ...bounds(start, end) }).then(next => {
      if (token !== contextRequest.current) return;
      setContexts(next); setRecordId(previous => next.records.some(record => record.record_id === previous) ? previous : next.records[0]?.record_id ?? null); setContextLoading(false);
    }).catch(() => { if (token === contextRequest.current) { setContexts({ records: [], total: 0 }); setContextLoading(false); setSourceError(t('approved.loadFailed')); } });
    return () => { contextRequest.current++; };
  }, [selected, start, end, revision, generation, t]);
  useLayoutEffect(() => { if (list.current && !loading) list.current.scrollTop = initial?.listScroll ?? 0; }, [loading, initial]);
  const index = Math.max(0, contexts.records.findIndex(record => record.record_id === recordId));
  const record = contexts.records[index];
  const currentRecordId=record?.record_id;
  const leave = useCallback(() => { if (prepareSavedReturn(currentRecordId)) back(); else dissolvePage(back,true); },[back,currentRecordId]);
  useEffect(() => backNavigation.setPage(() => { if(expanded)setExpanded(false);else leave();return true; },3),[expanded,leave]);
  const previousFolio = useRef<string | null>(null);
  useLayoutEffect(() => {
    if(currentRecordId)finishSavedEntrance(currentRecordId);
    const previous = previousFolio.current;
    previousFolio.current = currentRecordId ?? null;
    const node = detail.current; if (!node) return;
    node.scrollTop = 0;
    if (previous && currentRecordId && previous !== currentRecordId && !matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ transform: `translateX(${direction * 22}px)`, opacity: .45 }, { transform: 'none', opacity: 1 }], { duration: 185, easing: 'ease-out' });
  }, [currentRecordId, direction]);
  const choose = (id: string) => { if (performance.now() < suppress.current) return; setSelected(id); setRecordId(null); setExpanded(false); };
  const turn = (step: number) => { if (contexts.records[index + step]) { setDirection(step); setRecordId(contexts.records[index + step].record_id); } };
  const openSource = async () => {
    if (!record || sourceBusy) return;
    const token = ++sourceRequest.current; setSourceBusy(true); setSourceError('');
    try {
      const target = await resolveSavedSource(record);
      if (!alive.current || token !== sourceRequest.current) return;
      if (!target) { setSourceError(t('savedRecords.sourceMissing')); return; }
      views.set(key, snapshot.current);
      const visit = readerNavigation.create({ kind: 'saved', path: '/saved', view: { query, loadedGroups: groups.groups.length, expandedGroupId: selected, loadedContexts: {}, scrollTop: list.current?.scrollTop ?? 0, focusRecordId: record.record_id } }, target);
      navigate(`/files/${target.fileId}?segment=${target.segmentIndex}`, { state: { ...visitState(location), sourceVisitToken: visit } });
    } catch { if (alive.current && token === sourceRequest.current) setSourceError(t('savedRecords.sourceError')); }
    finally { if (alive.current && token === sourceRequest.current) setSourceBusy(false); }
  };
  const remove = async () => {
    if (!record || undoing) return false;
    const intent = removeIntents.current.get(record.record_id) ?? { operation: crypto.randomUUID(), revision: record.revision }; removeIntents.current.set(record.record_id, intent); setUndoing(true);
    try { await mutateSaved({ kind: 'remove', record_id: record.record_id, expected_revision: intent.revision }, intent.operation); setReceipt(intent.operation);setContexts(p=>({...p,records:p.records.filter(r=>r.record_id!==record.record_id),total:p.records.some(r=>r.record_id===record.record_id)?Math.max(0,p.total-1):p.total})); removeIntents.current.delete(record.record_id); return true; }
    catch (cause) { setSourceError(t(savedErrorKey(cause))); return false; } finally { setUndoing(false); }
  };
  const loadMore = async () => {
    const token = request.current; setLoading(true);
    try { const next = await invoke<SavedGroupPage>('list_saved_groups', { query, limit: 200, offset: groups.groups.length, ...bounds(start, end) }); if (token === request.current) setGroups(previous => ({ ...next, groups: [...previous.groups, ...next.groups] })); }
    catch { setFailure(true); } finally { if (token === request.current) setLoading(false); }
  };
  return <section className="approved-saved saved-workspace" aria-label={t('savedRecords.title')} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); } }}>
    <header className="approved-saved-header"><button className="approved-icon approved-back" aria-label={t('common.back')} onClick={leave}><ChevronLeft size={22}/></button><div className="approved-saved-search" data-open={searching}><input ref={input} type="search" aria-label={t('savedRecords.search')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearching(false); input.current?.blur(); } }}/><button className="approved-icon" aria-label={t('savedRecords.search')} aria-expanded={searching} onClick={() => setSearching(value => !value)}><Search size={21}/></button></div></header>
    <SavedTimeline bins={bins} recordCount={groups.total_records} start={start} end={end} status={timelineStatus} onRangeChange={(first, last) => { setStart(first); setEnd(last); }} onRetry={() => setRevision(value => value + 1)}/>
    <div className="approved-saved-columns" data-expanded={expanded}>
      <div ref={list} className="approved-saved-index" onKeyDown={event=>{
        if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('.approved-saved-word')];
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)));
        if(buttons[next]){event.preventDefault();buttons[next].focus();choose(buttons[next].dataset.group!);}
      }} onScroll={() => { snapshot.current.listScroll = list.current?.scrollTop ?? 0; }} onPointerDown={event => { gesture.current = { x: event.clientX, y: event.clientY, direction: null }; }} onPointerMove={event => { const g = gesture.current; if (!g) return; const x = event.clientX-g.x, y=event.clientY-g.y; if (!g.direction && Math.hypot(x,y)>8) g.direction=Math.abs(x)>Math.abs(y)?'x':'y'; if(g.direction==='y' && y>42) { setExpanded(true); suppress.current=performance.now()+350; } }} onPointerUp={() => { if (gesture.current?.direction) suppress.current=performance.now()+350; gesture.current=null; }}>
        {groups.groups.map(group => <button key={group.group_id} className="approved-saved-word" data-group={group.group_id} aria-pressed={selected === group.group_id} disabled={loading} onClick={() => choose(group.group_id)}><span lang="en">{group.expression}</span>{group.context_count > 1 && <small>{group.context_count}</small>}<i aria-hidden="true"/></button>)}
        {groups.groups.length < groups.total_groups && <button className="ui-button" disabled={loading} onClick={() => void loadMore()}>{t('approved.more')}</button>}
      </div>
      <button className="approved-index-toggle approved-icon" aria-expanded={expanded} aria-label={t('savedRecords.title')} onClick={() => setExpanded(value => !value)}><ChevronDown size={19}/></button>
      <div className="approved-saved-detail">
        {failure ? <div className="saved-error" role="alert"><p>{t('approved.loadFailed')}</p><button className="ui-button" onClick={() => setRevision(value => value+1)}>{t('common.retry')}</button></div> : loading && !groups.groups.length || contextLoading ? <div role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></div> : record ? <>
          {contexts.total > 1 && <nav className="approved-context-pager" aria-label={t('dictionaryFlow.moreContexts', { count:contexts.total })}><button className="approved-icon" disabled={index===0} aria-label={t('history.previous')} onClick={() => turn(-1)}><ChevronLeft size={18}/></button><span>{index+1} / {contexts.total}</span><button className="approved-icon" disabled={index>=contexts.records.length-1} aria-label={t('history.next')} onClick={() => turn(1)}><ChevronRight size={18}/></button>{contexts.records.length<contexts.total && <button className="ui-button" onClick={() => { const token=contextRequest.current; void invoke<SavedContextPage>('saved_group_contexts',{groupId:selected,limit:50,offset:contexts.records.length,...bounds(start,end)}).then(next=>{if(token===contextRequest.current)setContexts(previous=>({...next,records:[...previous.records,...next.records]}));}).catch(()=>setSourceError(t('approved.loadFailed'))); }}>{t('approved.more')}</button>}</nav>}
          <div ref={detail} className="approved-folio-scroll" onPointerDown={event => { if (!(event.target as Element).closest('button,input,textarea,summary')) gesture.current={x:event.clientX,y:event.clientY,direction:null}; }} onPointerMove={event=>{if(isTrashDragging()){gesture.current=null;return;}const g=gesture.current;if(!g)return;const x=event.clientX-g.x,y=event.clientY-g.y;if(!g.direction&&Math.hypot(x,y)>8)g.direction=Math.abs(x)>Math.abs(y)*1.25?'x':'y';}} onPointerUp={event=>{const g=gesture.current;gesture.current=null;if(!g)return;const x=event.clientX-g.x,y=event.clientY-g.y;if(g.direction==='x'&&Math.abs(x)>=36&&Math.abs(x)>Math.abs(y)*1.25){turn(x<0?1:-1);suppress.current=performance.now()+350;}}}>
            <SavedFolio key={record.record_id} record={record} sourceBusy={sourceBusy} onSource={() => { if(performance.now()>=suppress.current)void openSource(); }} onChange={next=>setContexts(previous=>({...previous,records:previous.records.map(value=>value.record_id===next.record_id?next:value)}))} onRemove={remove} removing={undoing}/>
          </div>
        </> : <p role="status" className="approved-saved-empty">{t(query || start || end ? 'materials.noMatches' : 'savedRecords.empty')}</p>}
        {sourceError && <p className="saved-error" role="alert">{sourceError}</p>}
        {receipt && <div className="recall-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" disabled={undoing} onClick={()=>{setUndoing(true);void undoSaved(receipt).then(()=>setReceipt(null)).catch(cause=>setSourceError(t(savedErrorKey(cause)))).finally(()=>setUndoing(false));}}><Undo2 size={18}/>{t('savedRecords.undo')}</button></div>}
      </div>
    </div>
  </section>;
}
function SavedFolio({ record, sourceBusy, onSource, onChange, onRemove, removing }: { record: SavedRecord; sourceBusy: boolean; onSource:()=>void; onChange:(record:SavedRecord)=>void; onRemove:()=>Promise<boolean>; removing:boolean }) {
  const { t } = useTranslation(), paragraph = useRef<HTMLParagraphElement>(null);
  const initial = useRef(savedNoteDrafts.get(record.record_id));
  const [editing,setEditing]=useState(!!initial.current?.editing),[draft,setDraft]=useState(initial.current?.text??(record.explanation_source==='personal'?record.explanation??'':'')),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const revision=useRef(initial.current?.revision??record.revision),operation=useRef(initial.current?.operationId);
  useTrashDrag(paragraph,{id:`saved:${record.record_id}`,label:record.sentence??record.expression,disabled:removing,remove:onRemove});
  const media = record.source?.media;
  const ready = useSourceMediaStore(s=>!!media && s.entries[media.source.key]?.status==='ready');
  const sentence=record.sentence??t('savedRecords.missingOriginal');
  const save=async()=>{if(busy)return;setBusy(true);setError('');operation.current??=crypto.randomUUID();savedNoteDrafts.set(record.record_id,{text:draft,revision:revision.current,operationId:operation.current,editing:true});try{const result=await mutateSaved({kind:'edit',record_id:record.record_id,expected_revision:revision.current,explanation:draft},operation.current);onChange(result.record);savedNoteDrafts.delete(record.record_id);revision.current=result.record.revision;operation.current=undefined;setEditing(false);}catch(cause){setError(t(savedErrorKey(cause)));}finally{setBusy(false);}};
  useEffect(()=>{if(!editing&&!savedNoteDrafts.has(record.record_id)){revision.current=record.revision;setDraft(record.explanation_source==='personal'?record.explanation??'':'');}},[record,editing]);
  useLayoutEffect(()=>{const node=paragraph.current;if(!node)return;const resize=()=>{const width=node.clientWidth;let size=sentence.length>100?48:sentence.length>56?57:72;while(size>32){node.style.fontSize=`${innerWidth<768?Math.min(45,Math.max(30,size*.63)):size}px`;if(node.scrollHeight<Math.max(160,innerHeight*.39)&&node.scrollWidth<=width)break;size-=2;}};resize();const observer=new ResizeObserver(resize);observer.observe(node.parentElement!);return()=>observer.disconnect();},[sentence]);
  const speechKey=`saved-folio:${record.record_id}`;
  return <article className="approved-saved-folio" data-record={record.record_id}>
    <header><button className="approved-source-cover" disabled={!record.source||sourceBusy} onClick={onSource} aria-label={t('savedRecords.returnToSource')}><MaterialCover src={savedCover(record)} identity={record.source?.content_hash??record.source_key}/></button><button className="approved-source-title" disabled={!record.source||sourceBusy} onClick={onSource} aria-label={t('savedRecords.returnToSource')}>{record.source?.file_name?bookmarkTitle(record.source.file_name):t('savedRecords.sourceMissing')}</button><SpeechButton className="approved-folio-speech" text={sentence} speechKey={speechKey} kind="sentence" label={t(ready&&media?.source.audio?'sourceAudio.playOriginal':'sourceAudio.read')} media={ready&&media?.source.audio?bindMediaTarget(media,{record_id:record.record_id}):undefined} idleIcon={<Volume2 size={39} strokeWidth={1.5}/>}/></header>
    <p ref={paragraph} className="approved-folio-sentence" lang="en" tabIndex={0} aria-label={sentence}><SavedExcerpt record={record} fallback={t('savedRecords.missingOriginal')}/></p>
    {record.sentence_translation&&<p className="approved-folio-translation">{record.sentence_translation}</p>}
    {editing?<form className="approved-folio-editor" onSubmit={event=>{event.preventDefault();void save();}}><label className="sr-only" htmlFor={`note-${record.record_id}`}>{t('dictionaryFlow.personalMeaning')}</label><textarea autoFocus id={`note-${record.record_id}`} value={draft} disabled={busy} onChange={event=>{setDraft(event.target.value);operation.current=undefined;savedNoteDrafts.set(record.record_id,{text:event.target.value,revision:revision.current,editing:true});}}/><div><button className="ui-button" type="submit" disabled={busy}>{t('savedRecords.saveExplanation')}</button><button className="ui-button" type="button" disabled={busy} onClick={()=>{savedNoteDrafts.set(record.record_id,{text:draft,revision:revision.current,editing:false});setEditing(false);}}>{t('common.cancel')}</button></div></form>:<button className="approved-folio-note" onClick={()=>setEditing(true)}><span>{t('dictionaryFlow.personalMeaning')}：</span>{record.explanation_source==='personal'&&record.explanation?record.explanation:t('reader.personalExplanation')}</button>}
    {error&&<p className="saved-error" role="alert">{error}</p>}<SpeechFeedback speechKeys={[speechKey]}/>

  </article>;
}
