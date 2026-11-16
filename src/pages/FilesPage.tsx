import { bookmarkTitle } from '../lib/bookmarkDesk';
import { dissolvePage } from '../lib/pageDissolve';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, ChevronLeft, ChevronRight, FolderOpen, MoreHorizontal, Pencil, Settings } from 'lucide-react';
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
import type { SavedGroupPage } from '../lib/savedRecords';
import { useTheme } from '../components/useTheme';
import MaterialCover from '../components/MaterialCover';
import Overlay from '../components/Overlay';
import TagEditDialog from '../components/TagEditDialog';
import { BusyRing } from '../components/LoadingFeedback';
import MaterialManager from './MaterialManager';
import PosterWall from '../components/PosterWall';
import { captureReadingEntrance, finishReadingReturn, readingMotionExcerpt } from '../lib/readingMotion';
import './approved-ui.css';

let lastLibraryTag = 'all';

export default function FilesPage() {
  const [params] = useSearchParams();
  return params.get('view') === 'manage' ? <MaterialManager/> : <MaterialDesk/>;
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
  const [pocket, setPocket] = useState('');
  const [pasting, setPasting] = useState(false), [turning, setTurning] = useState(false);
  const [groups, setGroups] = useState(params.get('view') === 'library' && !params.has('tag'));
  const card = useRef<HTMLDivElement>(null), libraryButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; locked: boolean } | null>(null), suppress = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { void useMaterialStore.getState().load(); void loadTags(); }, [catalog.revision, loadTags]);
  useEffect(() => {
    let alive = true;
    const load = () => void invoke<SavedGroupPage>('list_saved_groups', { query: '', limit: 1, offset: 0 }).then(page => { if (alive) setPocket(page.groups[0]?.expression ?? ''); }).catch(() => {});
    load(); window.addEventListener('lexicue-saved-changed', load);
    return () => { alive = false; window.removeEventListener('lexicue-saved-changed', load); };
  }, []);
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
  useLayoutEffect(() => { if (!selected || readingPosition(selected) === null || quotes[quoteKey]) finishReadingReturn(); }, [catalog.hasLoaded, selected, quotes, quoteKey]);
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
    if (pasting) return;
    if (useImportStore.getState().running) { useImportStore.getState().show(); return; }
    setPasting(true);
    try {
      const text = await readImportClipboard();
      const content = inspectClipboardContent(text);
      if (content.kind === 'error') { useFeedbackStore.getState().show(t(`materials.importDialog.${content.error}`), 'error'); return; }
      useImportStore.getState().show();
      window.dispatchEvent(new CustomEvent('lexicue-import-content', { detail: text }));
    } catch {
      useFeedbackStore.getState().show(t('materials.importDialog.clipboardFailed'), 'error');
      useImportStore.getState().show();
      window.dispatchEvent(new CustomEvent('lexicue-import-content', { detail: null }));
    } finally { setPasting(false); }
  };
  const wallTag = params.get('tag');
  const wallFiles = wallTag === 'all' ? catalog.files : wallTag === 'untagged' ? catalog.files.filter(file => !file.tags.length) : catalog.files.filter(file => file.tags.some(tag => String(tag.id) === wallTag));
  const tagName = wallTag === 'all' ? t('readingDesk.library') : wallTag === 'untagged' ? t('tags.untagged') : tags.find(tag => String(tag.id) === wallTag)?.name ?? t('readingDesk.library');
  useEffect(() => backNavigation.setPage(() => {
    if (wallTag !== null) { setParams({ view: 'library' }); setGroups(true); return true; }
    return false;
  }, 2), [wallTag, setParams]);
  return <div className="approved-desk" data-library-open={groups || undefined}>
    {wallTag !== null ? <PosterWall files={wallFiles} title={tagName} identity={wallTag} onBack={() => { setParams({ view: 'library' }); setGroups(true); }} onOpen={(file, node) => open(file, node, 'wall')} onManage={() => navigate('/files?view=manage')}/> : <>
      <header className="approved-home-header">
        <button className="approved-brand" aria-label={t(theme === 'midnight' ? 'approved.light' : 'approved.dark')} aria-pressed={theme === 'midnight'} onClick={() => setTheme(theme === 'midnight' ? 'sage' : 'midnight')}><img src={`/design/wordmark${theme === 'midnight' ? '-night' : ''}.png`} alt="LexiCue"/></button>
        <div><button data-guide="import" className="approved-icon import-tray" aria-label={t(importing ? 'materials.importRunning' : 'materials.importDialog.pasteLink')} aria-busy={pasting || importing} disabled={pasting} onClick={() => void paste()}>{pasting || importing ? <BusyRing/> : <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path className="tray-paper" d="M10 14V3h9l4 4v7M19 3v5h4M16 10v10m-4-4 4 4 4-4"/><path className="tray-bowl" d="m8 15-5 11h26l-5-11M4 23h8l2 3h4l2-3h8"/></svg>}</button>
          <button className="approved-icon home-file-picker" aria-label={t('materials.choose')} aria-busy={picking} onClick={() => { useImportStore.getState().show(); void useImportStore.getState().choose(); }}><FolderOpen size={23}/></button>
          <button className="approved-icon" aria-label={t('sidebar.settings')} onClick={() => navigate('/settings', { state: visitState(location) })}><Settings size={23}/></button>
        </div>
      </header>
      {catalog.loading && !catalog.hasLoaded ? <div className="approved-desk-status" role="status"><BusyRing/>{t('common.loading')}</div> : catalog.error ? <div className="approved-desk-status" role="alert"><p>{t('materials.loadFailed')}</p><button className="ui-button" onClick={() => void catalog.load()}>{t('common.retry')}</button></div> : selected ? <div ref={card} className="approved-deck desk-stack" tabIndex={0} aria-label={t('readingDesk.desktop')} data-turning={turning || undefined}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turn(event.key === 'ArrowRight' ? 1 : -1); } }}
        onPointerDown={event => { if (event.button === 0 && !(event.target as Element).closest('.approved-card-tag')) gesture.current = { x: event.clientX, y: event.clientY, locked: false }; }}
        onPointerMove={event => { const g = gesture.current; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if (Math.abs(dy) > Math.abs(dx) * 1.25 && !g.locked) gesture.current = null; else if (Math.abs(dx) > 8) g.locked = true; }}
        onPointerUp={event => { const g = gesture.current; gesture.current = null; if (!g) return; const dx = event.clientX - g.x, dy = event.clientY - g.y; if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy) * 1.25) { turn(dx < 0 ? 1 : -1); suppress.current = performance.now() + 350; } }} onPointerCancel={() => { gesture.current = null; }}>
        {recent.map((file, i) => <article className="approved-card desk-paper" key={`${file.id}:${file.content_hash}`} data-desk-active={i === index} data-desk-position={i - index} data-motion-file={file.id} aria-hidden={Math.abs(i - index) > 1 || undefined} inert={Math.abs(i - index) > 1}>
          <button className="approved-card-open" data-testid={i === index ? 'desk-continue' : undefined} aria-label={t('readingDesk.openNamed', { name: file.name })} onClick={event => {
            if (performance.now() < suppress.current) return;
            if (i !== index) { turn(i - index); return; }
            open(file, event.currentTarget.closest('article')!, 'desk');
          }}><MaterialCover src={materialCover(file)} identity={file.content_hash} className="approved-card-cover"/><span className="approved-card-copy"><span className="approved-card-category">{file.tags[0]?.name ?? t('tags.untagged')}</span><strong className="approved-card-title" lang="en">{bookmarkTitle(file.name)}</strong><span className="approved-card-quote" lang="en">{readingMotionExcerpt(file) ?? quotes[`${file.id}:${file.content_hash}:${readingPosition(file)}`] ?? file.preview}</span></span></button>
          {i === index && <button className="approved-card-tag" aria-label={t('tags.edit')} onClick={() => setEditing(file)}><Pencil size={16}/></button>}
        </article>)}
        <div className="approved-dots" data-visible={turning} aria-label={`${index + 1} / ${recent.length}`}>{recent.map((file, i) => <i key={file.id} data-current={i === index}/>)}</div>
        <button className="approved-edge approved-edge-prev" aria-label={t('history.previous')} disabled={index === 0} onClick={() => turn(-1)}><ChevronLeft size={18}/></button><button className="approved-edge approved-edge-next" aria-label={t('history.next')} disabled={index === recent.length - 1} onClick={() => turn(1)}><ChevronRight size={18}/></button>
      </div> : <div className="approved-desk-empty"><h1>{t(catalog.files.length ? 'readingDesk.clear' : 'readingDesk.noMaterials')}</h1><button className="desk-primary" onClick={() => { if (catalog.files.length) { setGroups(true); setParams({ view:'library' }); } else useImportStore.getState().show(); }}>{t(catalog.files.length ? 'readingDesk.library' : 'materials.import')}</button></div>}
      <footer className="approved-home-footer"><button ref={libraryButton} className="approved-library-entry desk-library-dock" aria-label={t('readingDesk.library')} aria-expanded={groups} onClick={() => { setGroups(true); setParams({ view: 'library' }); }}><span className="approved-stock" aria-hidden="true">{(catalog.files.length ? catalog.files.slice(0, 3) : [null, null, null]).map((file, i) => <MaterialCover key={i} src={file ? materialCover(file) : `/design/prints/${['16388','16398','16339'][i]}.jpg`} identity={file?.content_hash ?? String(i)}/>)}</span></button>
        <button className="approved-saved-entry" aria-label={t('savedRecords.title')} onClick={() => dissolvePage(() => navigate('/saved', { state: { ...visitState(location), dissolve: 'in' } }))}><span className="approved-word-pocket" aria-hidden="true"><i/><span><b>{pocket}</b><em/></span><i/></span></button>
      </footer>
    </>}
    {groups && !importOpen && wallTag === null && <TagRail files={catalog.files} tags={tags} returnFocus={() => libraryButton.current} onClose={() => { setGroups(false); setParams({}); }} onSelect={tag => { lastLibraryTag = tag; setGroups(false); setParams({ view: 'library', tag }); }} onManage={() => { setGroups(false); navigate('/files?view=manage'); }}/ >}
    {editing && <TagEditDialog file={editing} onClose={() => { setEditing(null); catalog.changed(); }}/ >}
  </div>;
}
function TagRail({ files, tags, returnFocus, onClose, onSelect, onManage }: { files: Material[]; tags: Material['tags']; returnFocus: () => HTMLElement | null; onClose: () => void; onSelect: (id: string) => void; onManage: () => void }) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null), rail = useRef<HTMLDivElement>(null), animations = useRef<Animation[]>([]);
  const items = [{ id: 'all', name: t('readingDesk.library'), files }, ...tags.map(tag => ({ id: String(tag.id), name: tag.name, files: files.filter(file => file.tags.some(value => value.id === tag.id)) })), ...files.some(file => !file.tags.length) ? [{ id: 'untagged', name: t('tags.untagged'), files: files.filter(file => !file.tags.length) }] : []];
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = panel.current?.querySelector<HTMLElement>(`[data-tag-id="${lastLibraryTag}"]`);
    if (target && rail.current) { rail.current.scrollLeft = target.offsetLeft - (rail.current.clientWidth - target.offsetWidth) / 2; target.focus({ preventScroll: true }); }
    const nodes = [...panel.current!.querySelectorAll<HTMLElement>('.approved-tag-group')].filter(node => { const r=node.getBoundingClientRect(); return r.right>0 && r.left<innerWidth; });
    animations.current = nodes.map((node, i) => { const r = node.getBoundingClientRect(); return node.animate([{ opacity: .18, transform: `translate(${50-r.x}px,${innerHeight-70-r.y}px) scale(.24) rotate(-13deg)` }, { opacity: 1, offset: .2 }, { transform: 'none', opacity: 1 }], { duration: 430, delay: i * 32, fill: 'both', easing: 'cubic-bezier(.22,.68,.22,1)' }); });
    return () => animations.current.forEach(animation => animation.cancel());
  }, []);
  const close = async () => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const jobs = animations.current;
      jobs.forEach(animation => { animation.playbackRate = -430 / 310; animation.play(); });
      await Promise.allSettled(jobs.map(animation => animation.finished));
    }
    onClose();
  };
  const magnify = (x?: number) => {
    const viewport = rail.current?.getBoundingClientRect();
    panel.current?.querySelectorAll<HTMLElement>('.approved-tag-group').forEach(node => { const r = node.getBoundingClientRect(); const distance = Math.abs((x ?? ((viewport?.left ?? 0) + (viewport?.width ?? innerWidth) / 2)) - r.left - r.width / 2); node.style.setProperty('--magnify', String(1 + .13 * Math.max(0, 1 - distance / (r.width * 1.35)))); });
  };
  return <Overlay label={t('readingDesk.library')} onClose={close} panelRef={panel} returnFocus={returnFocus} className="approved-tag-panel" layerClassName="approved-tag-layer"><button className="approved-icon approved-rail-back" aria-label={t('common.back')} onClick={() => void close()}><ArrowLeft size={22}/></button><div ref={rail} className="approved-tag-rail" onPointerMove={event => { if (event.pointerType === 'mouse') magnify(event.clientX); }} onPointerLeave={() => magnify()} onScroll={() => magnify()}><div className="approved-tag-track">{items.map(item => <button key={item.id} className="approved-tag-group" data-tag-id={item.id} aria-label={`${item.name} · ${item.files.length}`} onClick={() => onSelect(item.id)}><span className="approved-tag-stack" style={{ '--sheets': Math.min(8, item.files.length) } as React.CSSProperties}><MaterialCover src={item.files[0] ? materialCover(item.files[0]) : '/design/prints/16339.jpg'} identity={item.files[0]?.content_hash ?? item.id}/><strong>{item.name}</strong></span></button>)}</div></div><button className="approved-icon approved-manage" aria-label={t('approved.manage')} title={t('approved.manage')} onClick={onManage}><MoreHorizontal size={24}/></button></Overlay>;
}
