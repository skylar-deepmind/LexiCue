import { bookmarkTitle } from '../lib/bookmarkDesk';
import { dissolvePage } from '../lib/pageDissolve';
import { captureSavedEntrance, finishSavedReturn } from '../lib/savedEntrance';
import SavedPocketPreview from '../components/SavedPocketPreview';
import TagNamesDialog from '../components/TagNamesDialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { matchesMaterial, readingPosition } from '../lib/readingDesk';
import { materialCover } from '../lib/materialCover';
import { visitState } from '../lib/pageNavigation';
import { readImportClipboard } from '../lib/importLink';
import { inspectClipboardContent } from '../lib/clipboardContent';
import { backNavigation } from '../lib/backNavigation';
import type { Material, ReadingMaterial } from '../lib/materials';
import type { SavedGroupPage, SavedRecord } from '../lib/savedRecords';
import { useTheme } from '../components/useTheme';
import MaterialCover from '../components/MaterialCover';
import Overlay from '../components/Overlay';
import TagEditDialog from '../components/TagEditDialog';
import { BusyRing } from '../components/LoadingFeedback';
import { ClipboardImportIcon, FileImportIcon } from '../components/HomeActionIcons';
import useTrashDrag, { isTrashDragging } from '../components/useTrashDrag';
import PosterWall from '../components/PosterWall';
import { captureReadingEntrance, finishReadingReturn, readingMotionExcerpt } from '../lib/readingMotion';
import { playTagFlight } from '../lib/tagFlight';
import './approved-ui.css';

let lastLibraryTag = 'all';

export default function FilesPage() {
  return <MaterialDesk/>;
}
function MaterialDesk() {
  const { t } = useTranslation(), navigate = useNavigate(), location = useLocation();
  const [params, setParams] = useSearchParams();
  const catalog = useMaterialStore(), desk = useReadingDeskStore();
  const picking = useImportStore(s => s.picking), importing = useImportStore(s => s.running), importOpen = useImportStore(s => s.open);
  const tags = useFileStore(s => s.tags), loadTags = useFileStore(s => s.loadTags);
  const { theme, setTheme } = useTheme();
  const [editing, setEditing] = useState<Material | null>(null);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [pocket, setPocket] = useState<SavedRecord | null>(null);
  const [pasting, setPasting] = useState(false), [turning, setTurning] = useState(false);
  const [groups, setGroups] = useState(params.get('view') === 'library' && !params.has('tag'));
  const card = useRef<HTMLDivElement>(null), libraryButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; locked: boolean } | null>(null), suppress = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pasteIntent=useRef(0),pastePending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;pasteIntent.current++;};},[]);
  useEffect(() => { if(params.get('view')==='manage')setParams({view:'library'},{replace:true}); },[params,setParams]);
  useEffect(() => { void useMaterialStore.getState().load(); void loadTags(); }, [catalog.revision, loadTags]);
  useEffect(() => {
    let alive = true;
    const load = () => void invoke<SavedGroupPage>('list_saved_groups', { query: '', limit: 1, offset: 0 }).then(page => { if (alive) setPocket(page.groups[0]?.preview ?? null); }).catch(() => {});
    load(); window.addEventListener('lexicue-saved-changed', load);
    return () => { alive = false; window.removeEventListener('lexicue-saved-changed', load); };
  }, []);
  useLayoutEffect(() => { finishSavedReturn(pocket?.record_id); }, [pocket]);
  const recent = useMemo(() => {
    const kept = desk.desk.items.map(ref => catalog.files.find(file => matchesMaterial(ref, file))).filter((file): file is Material => !!file);
    return kept;
  }, [catalog.files, desk.desk.items]);
  const [fallback, setFallback] = useState<number | null>(null);
  const selected = recent.find(file => desk.desk.selected && matchesMaterial(desk.desk.selected, file)) ?? recent.find(file => file.id === fallback) ?? recent[0];
  const index = Math.max(0, recent.findIndex(file => file.id === selected?.id));
  const quoteKey = selected ? `${selected.id}:${selected.content_hash}:${readingPosition(selected)}` : '';
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void invoke<ReadingMaterial>('open_reading_material', { fileId: selected.id }).then(data => {
      if (!alive || data.material.content_hash !== selected.content_hash) return;
      const sentence = data.segments.find(segment => segment.index_num === (data.material.position?.segment ?? readingPosition(selected))) ?? data.segments[0];
      if (sentence) setQuotes(previous => ({ ...previous, [quoteKey]: sentence.en_text }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [quoteKey, selected]);
  useLayoutEffect(() => { if (!selected || readingPosition(selected) === null || quotes[quoteKey]) finishReadingReturn('desk'); }, [catalog.hasLoaded, selected, quotes, quoteKey]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (params.get('view') === 'library' && !params.has('tag')) setGroups(true);
  }, [params]);
  const turn = (step: number) => {
    const next = recent[index + step];
    if (!next) return;
    setFallback(next.id); desk.select(next); setTurning(true); clearTimeout(timer.current);
    timer.current = setTimeout(() => setTurning(false), 430);
  };
  const open = (file: Material, node: HTMLElement, origin: 'desk' | 'wall') => {
    if (origin === 'wall') desk.keepAndOpen(file);
    captureReadingEntrance(file, node, origin);
    navigate(`/files/${file.id}`, { state: { ...visitState(location), readingOrigin: origin === 'wall' ? 'library' : 'desk', readingMotion: true } });
  };
  const paste = async () => {
    if (pastePending.current) return;
    if (useImportStore.getState().running) { useImportStore.getState().show(); return; }
    const intent=++pasteIntent.current;pastePending.current=true;setPasting(true);
    try {
      const text = await readImportClipboard();
      if(!alive.current||intent!==pasteIntent.current)return;
      const content = inspectClipboardContent(text);
      if (content.kind === 'error') { useFeedbackStore.getState().show(t(content.error==='clipboardEmpty'?'approved.clipboardEmpty':`materials.importDialog.${content.error}`),'error',4500,undefined,'top');return; }
      if(content.kind==='youtube'){
        useImportStore.getState().showScene();
        window.dispatchEvent(new CustomEvent('lexicue-import-content',{detail:text}));
      } else await useImportStore.getState().fromContent(content.kind==='text'?'clipboard':'webpage',content.kind==='text'?content.text:content.url,true);
    } catch {
      if(!alive.current||intent!==pasteIntent.current)return;
      useFeedbackStore.getState().show(t('approved.clipboardUnavailable'),'error',6000,undefined,'top');
    } finally { if(alive.current&&intent===pasteIntent.current){pastePending.current=false;setPasting(false);} }
  };
  const wallTag = params.get('tag');
  const wallFiles = wallTag === 'all' ? catalog.files : wallTag === 'untagged' ? catalog.files.filter(file => !file.tags.length) : catalog.files.filter(file => file.tags.some(tag => String(tag.id) === wallTag));
  const tagName = wallTag === 'all' ? t('readingDesk.library') : wallTag === 'untagged' ? t('tags.untagged') : tags.find(tag => String(tag.id) === wallTag)?.name ?? t('readingDesk.library');
  useEffect(() => backNavigation.setPage(() => {
    if (wallTag !== null) { setParams({ view: 'library' }); setGroups(true); return true; }
    return false;
  }, 2), [wallTag, setParams]);
  return <div className="approved-desk" data-library-open={groups || undefined}>
    {wallTag !== null ? <PosterWall files={wallFiles} title={tagName} identity={wallTag} onBack={() => { setParams({ view: 'library' }); setGroups(true); }} onOpen={(file, node) => open(file, node, 'wall')}/> : <>
      <header className="approved-home-header">
        <button className="approved-brand" aria-label={t(theme === 'midnight' ? 'approved.light' : 'approved.dark')} aria-pressed={theme === 'midnight'} onClick={() => setTheme(theme === 'midnight' ? 'sage' : 'midnight')}><img src={`/design/wordmark${theme === 'midnight' ? '-night' : ''}.png`} alt="LexiCue"/></button>
        <div><button data-guide="import" className="approved-icon clipboard-import" aria-label={t(importing ? 'materials.importRunning' : 'materials.importDialog.pasteLink')} aria-busy={pasting || importing} disabled={pasting} onClick={() => void paste()}>{pasting || importing ? <BusyRing/> : <ClipboardImportIcon/>}</button>
          <button className="approved-icon home-file-picker import-tray" aria-label={t('materials.choose')} aria-busy={picking || importing} disabled={picking || importing || pasting} onClick={() => void useImportStore.getState().choose()}>{picking ? <BusyRing/> : <FileImportIcon/>}</button>
          <button className="approved-icon home-settings-action" aria-label={t('sidebar.settings')} onClick={() => navigate('/settings', { state: visitState(location) })}><Settings size={23}/></button>
        </div>
      </header>
      {catalog.loading && !catalog.hasLoaded ? <div className="approved-desk-status" role="status"><BusyRing/>{t('approved.loadingLibrary')}</div> : catalog.error ? <div className="approved-desk-status" role="alert"><p>{t('materials.loadFailed')}</p><button className="ui-button" onClick={() => void catalog.load()}>{t('common.retry')}</button></div> : selected ? <div ref={card} className="approved-deck" tabIndex={0} aria-label={t('readingDesk.desktop')} data-turning={turning || undefined}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turn(event.key === 'ArrowRight' ? 1 : -1); } }}
        onPointerDown={event => { if (event.button === 0 && !(event.target as Element).closest('.approved-tag-edit')) gesture.current = { x: event.clientX, y: event.clientY, locked: false }; }}
        onPointerMove={event => { if(isTrashDragging()){gesture.current=null;return;}const g = gesture.current; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if (Math.abs(dy) > Math.abs(dx) * 1.25 && !g.locked) gesture.current = null; else if (Math.abs(dx) > 8) g.locked = true; }}
        onPointerUp={event => { const g = gesture.current; gesture.current = null; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy) * 1.25) { turn(dx < 0 ? 1 : -1); suppress.current = performance.now() + 350; } }} onPointerCancel={() => { gesture.current = null; }}>
        {recent.map((file, i) => <TrashMaterial key={`${file.id}:${file.content_hash}`} file={file} enabled={i===index}><article className="approved-card" key={`${file.id}:${file.content_hash}`} data-desk-active={i === index} data-desk-position={i - index} data-motion-file={file.id} aria-hidden={Math.abs(i - index) > 1 || undefined} inert={Math.abs(i - index) > 1}>
          <button className="approved-card-open" data-testid={i === index ? 'desk-continue' : undefined} aria-label={t('readingDesk.openNamed', { name: file.name })} onClick={event => {
            if (performance.now() < suppress.current) return;
            if (i !== index) { turn(i - index); return; }
            open(file, event.currentTarget.closest('article')!, 'desk');
          }}><MaterialCover src={materialCover(file)} identity={file.content_hash} className="approved-card-cover"/></button><div className="approved-card-copy"><button className="approved-card-category approved-tag-edit" data-no-trash disabled={i !== index} aria-label={t('tags.edit')} onClick={() => setEditing(file)}>{file.tags[0]?.name ?? t('tags.untagged')}</button><strong className="approved-card-title" lang="en">{bookmarkTitle(file.name)}</strong><span className="approved-card-quote" lang="en">{readingMotionExcerpt(file) ?? quotes[`${file.id}:${file.content_hash}:${readingPosition(file)}`] ?? file.preview}</span></div>
        </article></TrashMaterial>)}
        <div className="approved-dots" data-visible={turning} aria-label={`${index + 1} / ${recent.length}`}>{recent.map((file, i) => <i key={file.id} data-current={i === index}/>)}</div>
        <button className="approved-edge approved-edge-prev" aria-label={t('history.previous')} disabled={index === 0} onClick={() => turn(-1)}><ChevronLeft size={18}/></button><button className="approved-edge approved-edge-next" aria-label={t('history.next')} disabled={index === recent.length - 1} onClick={() => turn(1)}><ChevronRight size={18}/></button>
      </div> : <div className="approved-desk-empty"><h1>{t(catalog.files.length ? 'readingDesk.clear' : 'readingDesk.noMaterials')}</h1><button className="desk-primary" onClick={() => { if (catalog.files.length) { setGroups(true); setParams({ view:'library' }); } else void useImportStore.getState().choose(); }}>{t(catalog.files.length ? 'readingDesk.library' : 'materials.import')}</button></div>}
      <footer className="approved-home-footer"><button ref={libraryButton} className="approved-library-entry" aria-label={t('readingDesk.library')} aria-expanded={groups} onClick={() => { setGroups(true); setParams({ view: 'library' }); }}><span className="approved-stock" aria-hidden="true">{(catalog.files.length ? catalog.files.slice(0, 3) : [null, null, null]).map((file, i) => <MaterialCover key={i} src={file ? materialCover(file) : `/design/prints/${['16388','16398','16339'][i]}.jpg`} identity={file?.content_hash ?? String(i)}/>)}</span></button>
        <button className="approved-saved-entry" aria-label={t('savedRecords.title')} onClick={event => {
          const open=()=>navigate('/saved',{state:{...visitState(location),pocketRecordId:pocket?.record_id}});
          if(captureSavedEntrance(pocket?.record_id,event.currentTarget.querySelector<HTMLElement>('.approved-pocket-sheet')))open();else dissolvePage(open);
        }}><span className="approved-word-pocket" aria-hidden="true"><i/><SavedPocketPreview record={pocket}/><i/></span></button>
      </footer>
    </>}
    {groups && !importOpen && wallTag === null && <TagRail files={catalog.files} tags={tags} returnFocus={() => libraryButton.current} onClose={() => { setGroups(false); setParams({}); }} onSelect={tag => { lastLibraryTag = tag; setGroups(false); setParams({ view: 'library', tag }); }}/ >}
    {editing && <TagEditDialog file={editing} onClose={() => { setEditing(null); catalog.changed(); }}/ >}
  </div>;
}
function TagRail({ files, tags, returnFocus, onClose, onSelect }: { files: Material[]; tags: Material['tags']; returnFocus: () => HTMLElement | null; onClose: () => void; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const [naming,setNaming] = useState<{id?:number}|null>(null);
  const panel = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null), flight = useRef<ReturnType<typeof playTagFlight> | null>(null), closing = useRef(false), mounted = useRef(true);
  const items = [{ id: 'all', name: t('readingDesk.library'), files }, ...tags.map(tag => ({ id: String(tag.id), name: tag.name, files: files.filter(file => file.tags.some(value => value.id === tag.id)) })), ...files.some(file => !file.tags.length) ? [{ id: 'untagged', name: t('tags.untagged'), files: files.filter(file => !file.tags.length) }] : []];
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = panel.current?.querySelector<HTMLElement>(`[data-tag-id="${lastLibraryTag}"]`);
    if (target && rail.current) { rail.current.scrollLeft = target.offsetLeft - (rail.current.clientWidth - target.offsetWidth) / 2; target.focus({ preventScroll: true }); }
    mounted.current=true;
    const anchor=returnFocus()?.querySelector<HTMLElement>('.approved-stock img:last-child')??returnFocus();
    flight.current=playTagFlight(panel.current,anchor);
    return () => { mounted.current=false;flight.current?.dispose(); };
  }, []);
  const close = async () => {
    if(closing.current)return;closing.current=true;flight.current?.dispose();
    const anchor=returnFocus()?.querySelector<HTMLElement>('.approved-stock img:last-child')??returnFocus();
    const next=flight.current=playTagFlight(panel.current,anchor,true);
    await Promise.allSettled(next.jobs.map(job=>job.finished));
    if(mounted.current)onClose();
  };
  const magnify = (x?: number) => {
    const viewport = rail.current?.getBoundingClientRect();
    panel.current?.querySelectorAll<HTMLElement>('.approved-tag-group').forEach(node => { const r = node.getBoundingClientRect(); const distance = Math.abs((x ?? ((viewport?.left ?? 0) + (viewport?.width ?? innerWidth) / 2)) - r.left - r.width / 2); node.style.setProperty('--magnify', String(1 + .13 * Math.max(0, 1 - distance / (r.width * 1.35)))); });
  };
  return <><Overlay label={t('readingDesk.library')} onClose={close} panelRef={panel} returnFocus={returnFocus} className="approved-tag-panel" layerClassName="approved-tag-layer"><button className="approved-icon approved-back approved-rail-back" aria-label={t('common.back')} onClick={() => void close()}><ChevronLeft size={22}/></button><div ref={rail} className="approved-tag-rail" onPointerMove={event => { if (event.pointerType === 'mouse') magnify(event.clientX); }} onPointerLeave={() => magnify()} onScroll={() => magnify()}><div className="approved-tag-track">{items.map(item => <div key={item.id} className="approved-tag-group" data-tag-id={item.id} tabIndex={-1}><div className="approved-tag-stack" style={{ '--sheets': Math.min(8, item.files.length) } as React.CSSProperties}><button className="approved-tag-open" aria-label={`${item.name} · ${item.files.length}`} onClick={() => onSelect(item.id)}><MaterialCover src={item.files[0] ? materialCover(item.files[0]) : '/design/prints/16339.jpg'} identity={item.files[0]?.content_hash ?? item.id}/></button><button className="approved-tag-name" aria-label={t(tags.some(tag => String(tag.id) === item.id) ? 'tags.renameNamed' : 'tags.manage', {name:item.name})} onClick={() => setNaming({id:tags.find(tag=>String(tag.id)===item.id)?.id})}><strong>{item.name}</strong></button></div></div>)}</div></div></Overlay>{naming && <TagNamesDialog tagId={naming.id} onClose={() => setNaming(null)}/>}</>;
}

/** The normal card remains the only navigation control; the wrapper owns hold/drag. */
function TrashMaterial({file,enabled,children}:{file:Material;enabled:boolean;children:React.ReactNode}) {
 const ref=useRef<HTMLDivElement>(null),deleting=useFileStore(s=>!!s.deletingFiles[file.id]);
 useTrashDrag(ref,{id:`material:${file.id}`,label:file.name,disabled:!enabled||deleting,remove:()=>useFileStore.getState().deleteFile(file.id,file.name,'trash-drop')});
 return <div ref={ref} className="approved-trash-material">{children}</div>;
}
