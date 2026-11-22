import { useLibraryNames } from '../components/useLibraryNames';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { LibraryNameKey } from '../lib/libraryNames';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import { dissolvePage } from '../lib/pageDissolve';
import { isIOSPlatform } from '../lib/platform';
import { cancelSavedFlight, captureSavedEntrance, finishSavedReturn } from '../lib/savedEntrance';
import EmptyMaterialGreeting from '../components/EmptyMaterialGreeting';
import { rearmEmptyMaterialGreeting } from '../lib/emptyMaterialGreeting';
import '../components/empty-material.css';
import SavedPocketPreview from '../components/SavedPocketPreview';
import InlineTagName from '../components/InlineTagName';
import HomeCardTags from '../components/HomeCardTags';
import LibraryCover from '../components/LibraryCover';
import LibraryCategoryCard from '../components/LibraryCategoryCard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight, Link2, Plus, Settings } from 'lucide-react';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import { openImportFrom, rememberImportFocus } from '../components/importFocus';
import { supportsMacLinkImport } from '../lib/importLink';
import { matchesMaterial, readingPosition } from '../lib/readingDesk';
import { materialCover } from '../lib/materialCover';
import { visitState } from '../lib/pageNavigation';
import { backNavigation } from '../lib/backNavigation';
import type { Material } from '../lib/materials';
import type { SavedRecord } from '../lib/savedRecords';
import { savedPocketCache, useSavedReadRevision } from '../lib/savedReadCache';
import { QueryCache } from '../lib/queryCache';
import { readingRoute, savedRoute, settingsRoute } from '../lib/routeModules';
import { useTheme } from '../components/useTheme';
import MaterialCover from '../components/MaterialCover';
import Overlay from '../components/Overlay';
import { BusyRing } from '../components/LoadingFeedback';
import useTrashDrag, { isTrashDragging } from '../components/useTrashDrag';
import PosterWall from '../components/PosterWall';
import { cancelReadingReturn, captureReadingEntrance, finishReadingReturn, readingMotionExcerpt } from '../lib/readingMotion';
import { playTagFlight } from '../lib/tagFlight';
import type { PosterEntrance } from '../lib/posterDeal';
import './approved-ui.css';
import '../components/import-material-card.css';

let lastLibraryTag = 'all';
const quoteCache = new QueryCache<string | null>(8);

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
  const libraryNames = useLibraryNames();
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const savedRevision = useSavedReadRevision();
  const [pocket, setPocket] = useState<SavedRecord | null>(() => savedPocketCache.peek('latest') ?? null);
  const [turning, setTurning] = useState(false);
  const [groups, setGroups] = useState(params.get('view') === 'library' && !params.has('tag'));
  const [wallEntrance, setWallEntrance] = useState<PosterEntrance | null>(null);
  const home = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null), libraryButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; locked: boolean } | null>(null), suppress = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if(params.get('view')==='manage')setParams({view:'library'},{replace:true}); },[params,setParams]);
  useEffect(() => { void useMaterialStore.getState().ensure(); void loadTags(); }, [catalog.revision, loadTags]);
  useEffect(() => {
    let active = true;
    void savedPocketCache.fetch('latest', () => invoke<SavedRecord | null>('latest_saved_preview'))
      .then(record => { if (active) setPocket(record); }).catch(() => {});
    return () => { active = false; };
  }, [savedRevision]);
  useEffect(() => {
    if (!catalog.hasLoaded) return;
    const prepare = () => { readingRoute.preload(); savedRoute.preload(); settingsRoute.preload(); };
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(prepare);
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(prepare, 160);
    return () => window.clearTimeout(timer);
  }, [catalog.hasLoaded]);
  useLayoutEffect(() => { finishSavedReturn(pocket?.record_id); }, [pocket]);
  const recent = useMemo(() => {
    const kept = desk.desk.items.map(ref => catalog.files.find(file => matchesMaterial(ref, file))).filter((file): file is Material => !!file);
    return kept;
  }, [catalog.files, desk.desk.items]);
  useEffect(() => { if (catalog.hasLoaded && recent.length) rearmEmptyMaterialGreeting(); }, [catalog.hasLoaded, recent.length]);
  const [fallback, setFallback] = useState<number | null>(null);
  const selected = recent.find(file => desk.desk.selected && matchesMaterial(desk.desk.selected, file)) ?? recent.find(file => file.id === fallback) ?? recent[0];
  const index = Math.max(0, recent.findIndex(file => file.id === selected?.id));
  const selectedId = selected?.id, selectedHash = selected?.content_hash;
  const segment = selected ? readingPosition(selected) : null;
  const quoteKey = selected ? `${selectedId}:${selectedHash}:${segment}` : '';
  useEffect(() => {
    if (selectedId === undefined || !selectedHash || segment === null) return;
    let active = true;
    void quoteCache.fetch(quoteKey, () => invoke<string | null>('reading_material_preview', {
      fileId: selectedId, contentHash: selectedHash, segment,
    })).then(quote => {
      if (active && quote !== null) setQuotes(previous => ({ ...previous, [quoteKey]: quote }));
    }).catch(() => {});
    return () => { active = false; };
  }, [quoteKey, selectedId, selectedHash, segment]);
  useLayoutEffect(() => {
    if (catalog.hasLoaded && (!selectedId || segment === null || quotes[quoteKey])) finishReadingReturn('desk');
  }, [catalog.hasLoaded, selectedId, segment, quotes, quoteKey]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (params.get('view') === 'library' && !params.has('tag')) setGroups(true);
  }, [params]);
  const turn = (step: number) => {
    const next = recent[index + step];
    if (!next) return;
    setFallback(next.id); desk.select(next); setTurning(true); clearTimeout(timer.current);
    timer.current = setTimeout(() => setTurning(false), 2000);
  };
  const open = (file: Material, node: HTMLElement, origin: 'desk' | 'wall') => {
    if (origin === 'wall') desk.keepAndOpen(file);
    captureReadingEntrance(file, node, origin);
    navigate(`/files/${file.id}`, { state: { ...visitState(location), readingOrigin: origin === 'wall' ? 'library' : 'desk', readingMotion: true } });
  };
  useLayoutEffect(() => {
    const desk = home.current;
    if (!desk || !isIOSPlatform()) return;
    // WKWebView can drop the synthesized click while a return snapshot is
    // compositing. Activate stationary taps on the two live home controls.
    let tap: { button: HTMLButtonElement; id: number; x: number; y: number; start: number } | null = null;
    const clearTap = () => { tap = null; };
    const withinTap = (touch: Touch, start: { x: number; y: number }) =>
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) <= 7;
    const startTap = (event: TouchEvent) => {
      clearTap();
      const target = event.target;
      if (!(target instanceof Element) || event.touches.length !== 1 || event.defaultPrevented) return;
      const button = target.closest<HTMLButtonElement>('.approved-card-open,.approved-saved-entry');
      if (!button || button.disabled) return;
      const touch = event.touches[0];
      tap = { button, id: touch.identifier, x: touch.clientX, y: touch.clientY, start: performance.now() };
    };
    const moveTap = (event: TouchEvent) => {
      if (tap && (event.touches.length !== 1 || !withinTap(event.touches[0], tap))) clearTap();
    };
    const endTap = (event: TouchEvent) => {
      const start = tap;
      clearTap();
      if (!start || event.touches.length || event.defaultPrevented || !event.cancelable
          || isTrashDragging() || performance.now() - start.start >= 500) return;
      const touch = event.changedTouches[0];
      if (touch?.identifier !== start.id || !withinTap(touch, start)
          || !start.button.contains(document.elementFromPoint(touch.clientX, touch.clientY))) return;
      event.preventDefault();
      start.button.click();
    };
    desk.addEventListener('touchstart', startTap, { passive: true });
    desk.addEventListener('touchmove', moveTap, { passive: true });
    desk.addEventListener('touchcancel', clearTap);
    desk.addEventListener('touchend', endTap, { passive: false });
    return () => {
      desk.removeEventListener('touchstart', startTap);
      desk.removeEventListener('touchmove', moveTap);
      desk.removeEventListener('touchcancel', clearTap);
      desk.removeEventListener('touchend', endTap);
    };
  }, []);
  const wallTag = params.get('tag');
  const wallFiles = useMemo(() => wallTag === 'all' ? catalog.files : catalog.files.filter(file =>
    wallTag === 'untagged' ? !file.tags.length : file.tags.some(tag => String(tag.id) === wallTag)), [catalog.files, wallTag]);
  const returnToTags = useCallback(() => { setWallEntrance(null); setParams({ view: 'library' }); setGroups(true); }, [setParams]);
  const tagName = wallTag === 'all' ? libraryNames.all : wallTag === 'untagged' ? libraryNames.untagged : tags.find(tag => String(tag.id) === wallTag)?.name ?? t('readingDesk.library');
  useEffect(() => backNavigation.setPage(() => {
    if (wallTag !== null) { returnToTags(); return true; }
    return false;
  }, 2), [wallTag, returnToTags]);
  return <div className="approved-desk" ref={home} data-library-open={groups || undefined}>
    {wallTag !== null ? <PosterWall key={wallTag} files={wallFiles} title={tagName} identity={wallTag} entrance={wallEntrance?.tag === wallTag ? wallEntrance : null} onBack={returnToTags} onOpen={(file, node) => open(file, node, 'wall')}/> : <>
      <header className="approved-home-header">
        <button className="approved-brand" aria-label={t(theme === 'midnight' ? 'approved.light' : 'approved.dark')} aria-pressed={theme === 'midnight'} onClick={() => setTheme(current => current === 'midnight' ? 'sage' : 'midnight')}><span className="approved-wordmark" aria-hidden="true"/></button>
        <div>{supportsMacLinkImport() && <button type="button" className="approved-icon"
          aria-label={t('materials.importDialog.linkTitle')} title={t('materials.importDialog.linkTitle')}
          aria-haspopup="dialog" disabled={picking || importing} onClick={event => {
            rememberImportFocus(event.currentTarget);
            useImportStore.getState().showLink();
          }}><Link2 size={23} aria-hidden="true" /></button>}
          <button type="button" data-guide="import" className="approved-icon home-import-action"
          aria-label={t(importing ? 'materials.importRunning' : 'materials.import')} aria-haspopup="dialog" aria-expanded={importOpen}
          aria-busy={picking || importing} disabled={picking} onClick={event => openImportFrom(event.currentTarget)}>
          {picking || importing ? <BusyRing/> : <Plus size={24} aria-hidden="true"/>}
        </button>
          <button className="approved-icon home-settings-action" onPointerDown={settingsRoute.preload} onFocus={settingsRoute.preload} aria-label={t('sidebar.settings')} onClick={() => navigate('/settings', { state: visitState(location) })}><Settings size={23}/></button>
        </div>
      </header>
      {catalog.loading && !catalog.hasLoaded ? <div className="approved-desk-status" role="status"><BusyRing/>{t('approved.loadingLibrary')}</div> : catalog.error ? <div className="approved-desk-status" role="alert"><p>{t('materials.loadFailed')}</p><button className="ui-button" onClick={() => void catalog.load()}>{t('common.retry')}</button></div> : selected ? <div ref={card} className="approved-deck" tabIndex={0} aria-label={t('readingDesk.desktop')} data-turning={turning || undefined}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turn(event.key === 'ArrowRight' ? 1 : -1); } }}
        onPointerDown={event => { if (event.button === 0 && !(event.target as Element).closest('.approved-tag-edit,.gesture-bottom-edge')) { suppress.current=0; gesture.current = { x: event.clientX, y: event.clientY, locked: false }; } }}
        onPointerMove={event => { if(isTrashDragging()||document.documentElement.hasAttribute('data-home-scrub')){gesture.current=null;return;}const g = gesture.current; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if (Math.abs(dy) > Math.abs(dx) * 1.25 && !g.locked) gesture.current = null; else if (Math.abs(dx) > 8&&!g.locked) { g.locked = true; setTurning(true); clearTimeout(timer.current); } }}
        onPointerUp={event => { const g = gesture.current; gesture.current = null; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if(g.locked)suppress.current=performance.now()+350; if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy) * 1.25) { turn(dx < 0 ? 1 : -1); suppress.current = performance.now() + 350; } else if(g.locked)timer.current=setTimeout(()=>setTurning(false),2000); }} onPointerCancel={() => { if(gesture.current?.locked)timer.current=setTimeout(()=>setTurning(false),2000);gesture.current = null; }}>

        {recent.map((file, i) => <TrashMaterial key={`${file.id}:${file.content_hash}`} file={file} enabled={i===index}><article className="approved-card" key={`${file.id}:${file.content_hash}`} data-desk-active={i === index} data-desk-position={i - index} data-motion-file={file.id} aria-hidden={Math.abs(i - index) > 1 || undefined} inert={Math.abs(i - index) > 1}>
          <button className="approved-card-open" onPointerDown={readingRoute.preload} onFocus={readingRoute.preload} data-testid={i === index ? 'desk-continue' : undefined} aria-label={t('readingDesk.openNamed', { name: file.name })} onClick={event => {
            if (performance.now() < suppress.current) return;
            if (i !== index) { turn(i - index); return; }
            cancelSavedFlight();
            open(file, event.currentTarget.closest('article')!, 'desk');
          }}><MaterialCover src={materialCover(file)} identity={file.content_hash} className="approved-card-cover"/></button><button className="approved-card-category approved-tag-edit material-floating-tag" data-no-trash disabled={i!==index} aria-label={t('tags.edit')+' · '+(file.tags[0]?.name??libraryNames.untagged)} onClick={()=>window.dispatchEvent(new Event('home-tag-picker'))}><span>{file.tags[0]?.name??libraryNames.untagged}</span></button><div className="approved-card-copy"><strong className="approved-card-title" lang="en">{bookmarkTitle(file.name)}</strong><span className="approved-card-quote" lang="en">{readingMotionExcerpt(file) ?? quotes[`${file.id}:${file.content_hash}:${readingPosition(file)}`] ?? file.preview}</span></div>
          {i===index&&<span aria-hidden="true" data-no-trash="" className="gesture-bottom-edge"/>}
        </article></TrashMaterial>)}
        <div className="approved-dots" data-visible={turning} aria-label={`${index + 1} / ${recent.length}`}>{recent.map((file, i) => <i key={file.id} data-current={i === index}/>)}</div>
        <button className="approved-edge approved-edge-prev" aria-label={t('history.previous')} disabled={index === 0} onClick={() => turn(-1)}><ChevronLeft size={18}/></button><button className="approved-edge approved-edge-next" aria-label={t('history.next')} disabled={index === recent.length - 1} onClick={() => turn(1)}><ChevronRight size={18}/></button>
      </div> : <EmptyMaterialGreeting/>}
        {selected&&!groups&&!importOpen&&!catalog.error&&(catalog.hasLoaded||!catalog.loading)&&<HomeCardTags key={selected.id} file={selected}/>}
      <footer className="approved-home-footer"><button ref={libraryButton} className="approved-library-entry" aria-label={t('readingDesk.library')} aria-expanded={groups} onClick={() => { setGroups(true); setParams({ view: 'library' }); }}><span className="approved-stock" data-count={Math.min(catalog.files.length,3)} aria-hidden="true">{(catalog.files.length ? catalog.files.slice(0, 3) : [null]).map((file, i) => <MaterialCover key={i} src={file ? materialCover(file) : '/design/empty-material/waiting.png'} identity={file?.content_hash ?? String(i)}/>)}</span></button>
        <button className="approved-saved-entry" onPointerDown={savedRoute.preload} onFocus={savedRoute.preload} aria-label={t('savedRecords.title')} onClick={event => {
          cancelReadingReturn();
          const open=()=>navigate('/saved',{state:{...visitState(location),pocketRecordId:pocket?.record_id}});
          if(captureSavedEntrance(pocket?.record_id,event.currentTarget.querySelector<HTMLElement>('.approved-pocket-sheet')))open();else dissolvePage(open);
        }}><span className="approved-word-pocket" aria-hidden="true"><i/><SavedPocketPreview record={pocket}/><i/></span></button>
      </footer>
    </>}
    {groups && !importOpen && wallTag === null && <TagRail files={catalog.files} tags={tags} returnFocus={() => libraryButton.current} onClose={() => { setGroups(false); setParams({}); }} onSelect={(tag, origin) => {
      lastLibraryTag = tag;
      setWallEntrance({ tag, origin });
      setGroups(false);
      setParams({ view: 'library', tag });
    }}/ >}
  </div>;
}
function TagRail({ files, tags, returnFocus, onClose, onSelect }: { files: Material[]; tags: Material['tags']; returnFocus: () => HTMLElement | null; onClose: () => void; onSelect: (id: string, source: DOMRect) => void }) {
  const { t } = useTranslation();
  const [editingId,setEditingId] = useState<string|null>(null);
  const libraryNames = useLibraryNames();
  const renameDefault = (key: LibraryNameKey, name: string) => {
    const normalized = name.trim().normalize('NFC').toLowerCase();
    const other = key === 'all' ? libraryNames.untagged : libraryNames.all;
    if (normalized !== libraryNames[key].toLowerCase() && (tags.some(tag => tag.name.toLowerCase() === normalized) || other.toLowerCase() === normalized)) throw Error('tag name already exists');
    usePreferencesStore.getState().setLibraryName(key, name);
  };
  const panel = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null), flight = useRef<ReturnType<typeof playTagFlight> | null>(null), closing = useRef(false), mounted = useRef(true);
  const items = [{ id: 'all', name: libraryNames.all, files }, ...tags.map(tag => ({ id: String(tag.id), name: tag.name, files: files.filter(file => file.tags.some(value => value.id === tag.id)) })), ...files.some(file => !file.tags.length) ? [{ id: 'untagged', name: libraryNames.untagged, files: files.filter(file => !file.tags.length) }] : []];
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
    if(panel.current?.querySelector('.approved-tag-name-editor[aria-busy="true"]'))return false;
    if(editingId!==null){setEditingId(null);return false;}
    if(closing.current)return;closing.current=true;flight.current?.dispose();
    const anchor=returnFocus()?.querySelector<HTMLElement>('.approved-stock img:last-child')??returnFocus();
    const next=flight.current=playTagFlight(panel.current,anchor,true);
    await Promise.allSettled(next.jobs.map(job=>job.finished));
    if(mounted.current)onClose();
  };
  return <Overlay label={t('readingDesk.library')} onClose={close} panelRef={panel} returnFocus={returnFocus} className="approved-tag-panel" layerClassName="approved-tag-layer">
    <button className="approved-icon approved-back approved-rail-back" aria-label={t('common.back')} onClick={() => void close()}><ChevronLeft size={22}/></button>
    <div ref={rail} className="approved-tag-rail"><div className="approved-tag-track">
      {items.map(item => {
        const tag = tags.find(tag => String(tag.id) === item.id);
        const saving = () => !!panel.current?.querySelector('.approved-tag-name-editor[aria-busy="true"]');
        const rename = (name: string) => tag
          ? useFileStore.getState().renameTag(tag.id, name)
          : renameDefault(item.id as LibraryNameKey, name);
        return <div key={item.id} className="approved-tag-group" data-tag-id={item.id} tabIndex={-1}>
          <LibraryCategoryCard tag={tag} disabled={editingId!==null}>
            <button className="approved-tag-open" aria-label={`${item.name} · ${item.files.length}`} onClick={event => {
              if (!saving()) onSelect(item.id, event.currentTarget.getBoundingClientRect());
            }}><LibraryCover files={item.files}/></button>
            <InlineTagName name={item.name} editing={editingId===item.id} onRename={rename}
              onEdit={() => { if (!saving()) setEditingId(item.id); }}
              onFinish={() => setEditingId(current => current === item.id ? null : current)}/>
          </LibraryCategoryCard>
        </div>;
      })}
    </div></div>
  </Overlay>;
}

/** The normal card remains the only navigation control; the wrapper owns hold/drag. */
function TrashMaterial({file,enabled,children}:{file:Material;enabled:boolean;children:React.ReactNode}) {
 const ref=useRef<HTMLDivElement>(null),deleting=useFileStore(s=>!!s.deletingFiles[file.id]);
 useTrashDrag(ref,{id:`material:${file.id}`,label:file.name,disabled:!enabled||deleting,remove:()=>useFileStore.getState().deleteFile(file.id,file.name,'trash-drop')});
 return <div ref={ref} className="approved-trash-material">{children}</div>;
}
