import { LoadingSkeleton, BusyRing } from '../components/LoadingFeedback';
import { isMobilePlatform } from '../lib/platform';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Archive, BookOpen, X, Check, ChevronLeft, ChevronRight, ChevronsUp, FileText, MoreHorizontal, Search, Tags, Pencil } from 'lucide-react';
import { useMaterialStore } from '../stores/materialStore';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { matchesMaterial, readingPosition } from '../lib/readingDesk';
import { readLibraryView, saveLibraryView } from '../lib/libraryView';
import { backNavigation } from '../lib/backNavigation';
import type { Material, ReadingMaterial } from '../lib/materials';
import TagFilterBar from '../components/TagFilterBar';
import TagManager from '../components/TagManager';
import TagEditDialog from '../components/TagEditDialog';
import TagBadge from '../components/TagBadge';
import DeskFeedback from '../components/DeskFeedback';
import { useMediaQuery } from '../components/useMediaQuery';
import useSheetDrag from '../components/useSheetDrag';
import Overlay from '../components/Overlay';
import { rememberImportFocus } from '../components/importFocus';
import MotionChange from '../components/MotionChange';
import { useQuietScrollbars } from '../components/useQuietScrollbars';
import { deskCardTransform, useSoftCardTurn } from '../components/useSoftCardTurn';
import useBookmarkDesk from '../components/useBookmarkDesk';
import {bookmarkExcerpt,bookmarkTitle} from '../lib/bookmarkDesk';
import './materials-settings.css';
import './reading-stage.css';
import './desktop-desk-height.css';

// Keep the rendered prefix when returning from a material in this session.
let sessionLibraryCount = 30;

export default function FilesPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [params, setParams] = useSearchParams();
    const compact = useMediaQuery('(max-width: 767px)');
    const mobileSheet = compact || isMobilePlatform();
    const importOpen = useImportStore(s => s.open);
    const library = params.get('view') === 'library' && !importOpen;
    const materials = useMaterialStore();
    const desk = useReadingDeskStore();
    const selectedTags = useFileStore(s => s.selectedTagIds);
    const untagged = useFileStore(s => s.untaggedOnly);
    const loadTags = useFileStore(s => s.loadTags);
    const deleting = useFileStore(s => s.deletingFiles);
    const [saved] = useState(readLibraryView);
    const [query, setQuery] = useState(saved.query);
    const [range, setRange] = useState(saved.range);
    const [tagsOpen, setTagsOpen] = useState(saved.tagsOpen);
    const [libraryPresent, setLibraryPresent] = useState(library);
    const [visibleCount, setVisibleCount] = useState(sessionLibraryCount);
    const filterKey = useRef(`${saved.query}:${saved.range}:${saved.tagIds.join(',')}:${saved.untagged}`);
    const [expanded, setExpanded] = useState<number | null>(saved.expandedId??null);
    const [manager, setManager] = useState(false);
    const [edit, setEdit] = useState<Material | null>(null);
    const [menu, setMenu] = useState<number | null>(null);
    const scroll = useRef<HTMLDivElement>(null);
    useQuietScrollbars(scroll, libraryPresent && (!materials.loading || materials.hasLoaded));
    useEffect(() => {
        if (library) { setLibraryPresent(true); return; }
        const timer = window.setTimeout(() => setLibraryPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : mobileSheet ? 300 : 420);
        return () => clearTimeout(timer);
    }, [library, mobileSheet]);
    useEffect(() => {
        const next = `${query}:${range}:${selectedTags.join(',')}:${untagged}`;
        if (filterKey.current === next) return;
        filterKey.current = next; sessionLibraryCount = 30; setVisibleCount(30); setExpanded(null);
    }, [query, range, selectedTags, untagged]);
    const dock = useRef<HTMLButtonElement>(null);
    const shelf = useRef<HTMLDivElement>(null);
    const emptyImport = useRef<HTMLButtonElement>(null);
    const libraryReturnTarget = () => {
        if (dock.current) return dock.current;
        if (emptyImport.current?.getClientRects().length) return emptyImport.current;
        // Compact layouts expose the header's import action instead of the desktop empty-state button.
        return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-guide="import"]'))
            .find(button => button.getClientRects().length > 0) ?? null;
    };
    const libraryPanel = useRef<HTMLDivElement>(null);
    const wasLibraryPresent = useRef(libraryPresent);
    useEffect(() => {
        const closed = wasLibraryPresent.current && !libraryPresent;
        wasLibraryPresent.current = libraryPresent;
        if (!closed || library) return;
        // Wait until the exit overlay is removed and the dock is visible again.
        const frame = requestAnimationFrame(() => {
            const target = libraryReturnTarget();
            if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [libraryPresent, library]);
    useLayoutEffect(() => {
        const panel = libraryPanel.current, anchor = dock.current;
        const layer = panel?.closest<HTMLElement>('.library-overlay-layer');
        if (!libraryPresent || !panel || !anchor || !layer) return;
        const align = () => {
            // The desktop panel shares the dock's centre and baseline. A phone
            // sheet is positioned entirely by its visual viewport and safe area.
            if (mobileSheet) {
                for (const property of ['padding-left', 'padding-right', 'padding-bottom', '--library-bottom-gap']) {
                    layer.style.removeProperty(property);
                }
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const width = document.documentElement.clientWidth, height = window.innerHeight;
            const center = Math.max(16, Math.min(width - 16, rect.left + rect.width / 2));
            layer.style.paddingLeft = `${Math.max(16, 2 * center - width + 16)}px`;
            layer.style.paddingRight = `${Math.max(16, width - 2 * center + 16)}px`;
            const gap = rect.bottom > 0 && rect.top < height
                ? Math.min(Math.max(16, height - rect.bottom), Math.max(16, height - 320)) : 16;
            layer.style.paddingBottom = `${gap}px`;
            layer.style.setProperty('--library-bottom-gap', `${gap}px`);
        };
        align();
        const observer = new ResizeObserver(align);
        observer.observe(anchor);
        if (anchor.parentElement?.parentElement) observer.observe(anchor.parentElement.parentElement);
        window.addEventListener('resize', align);
        return () => { observer.disconnect(); window.removeEventListener('resize', align); };
    }, [libraryPresent, materials.hasLoaded, materials.error, mobileSheet]);
    const paper = useRef<HTMLElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const scrollTop = useRef(saved.scroll);
    const focusId = useRef(saved.focusId);
    const motion = useRef<{node:HTMLElement;animation:Animation} | null>(null);
    const lastArchive = useRef(-Infinity);
    const previousLibrary = useRef(library);
    const restored = useRef(false);
    const filtersRestored = useRef(false);
    const cancelMotion = () => { motion.current?.animation.cancel(); motion.current?.node.remove(); motion.current = null; };
    useEffect(() => {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        window.addEventListener('resize', cancelMotion); reduced.addEventListener('change', cancelMotion);
        return () => { cancelMotion(); window.removeEventListener('resize', cancelMotion); reduced.removeEventListener('change', cancelMotion); useReadingDeskStore.getState().clearNotice(); };
    }, []);
    useEffect(() => { void useMaterialStore.getState().load(); void loadTags(); }, [materials.revision, loadTags]);
    // Session filters are restored once; subsequent filtering uses the full local metadata list.
    useLayoutEffect(() => {
        if (!filtersRestored.current && library) {
            filtersRestored.current=true;
            if (library) useFileStore.getState().setTagFilter(saved.tagIds, saved.untagged);
        }
    }, [library,saved.tagIds,saved.untagged]);
    useEffect(() => {
        saveLibraryView({query,range,tagsOpen,tagIds:selectedTags,untagged,scroll:scrollTop.current,focusId:focusId.current,expandedId:expanded});
    }, [query,range,tagsOpen,selectedTags,untagged,expanded]);
    useEffect(() => backNavigation.setPage(() => {
        if (!library) return false;
        setParams({}, {replace:true}); return true;
    }, 1), [library,setParams]);
    useLayoutEffect(() => {
        if (materials.loading) { if (!materials.hasLoaded) restored.current=false; return; }
        if (materials.error) { restored.current=false; return; }
        if (previousLibrary.current !== library) {
            cancelMotion(); restored.current = false; useReadingDeskStore.getState().clearNotice();
            previousLibrary.current = library;
        }
        if (!restored.current) {
            if (library) {
                if (!scroll.current) return;
                if (scroll.current) scroll.current.scrollTop = scrollTop.current;
                const target = focusId.current && location.state?.restoreLibrary ? scroll.current?.querySelector<HTMLButtonElement>(`[data-open="${focusId.current}"]`) : null;
                (target ?? (isMobilePlatform() || innerWidth < 768 ? libraryPanel.current : search.current))?.focus({preventScroll:true});
            } else if (location.state?.restoreLibrary) dock.current?.focus({preventScroll:true});
            restored.current = true;
        }
    }, [library, materials.loading, materials.hasLoaded, materials.error, location.state, libraryPresent]);
    useEffect(() => {
        if (menu === null || library) return;
        const close = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest('.desk-card-menu')) setMenu(null); };
        document.addEventListener('pointerdown', close);
        const unregister = backNavigation.register(() => { setMenu(null); return true; });
        return () => { document.removeEventListener('pointerdown', close); unregister(); };
    }, [menu,library]);
    useLayoutEffect(() => {
        if (menu === null || !library) return;
        const viewport = scroll.current;
        const popup = viewport?.querySelector<HTMLElement>(`[data-material="${menu}"] .material-actions`);
        if (!viewport || !popup) return;
        const bounds = viewport.getBoundingClientRect(), rect = popup.getBoundingClientRect();
        if (rect.bottom > bounds.bottom - 8) viewport.scrollTop += rect.bottom - bounds.bottom + 8;
        else if (rect.top < bounds.top + 8) viewport.scrollTop -= bounds.top + 8 - rect.top;
    }, [menu, library]);
    useEffect(() => {
        if (menu === null || !library) return;
        return backNavigation.register(() => { setMenu(null); scroll.current?.querySelector<HTMLButtonElement>(`[data-material="${menu}"] .library-menu > button`)?.focus({preventScroll:true}); });
    }, [menu,library]);
    const onDesk = (file: Material) => desk.desk.items.some(ref => matchesMaterial(ref,file));
    const desktop = desk.desk.items.map(ref => materials.files.find(file => matchesMaterial(ref,file))).filter((file): file is Material => !!file);
    const main = desktop.find(file => desk.desk.selected && matchesMaterial(desk.desk.selected,file)) ?? desktop[0];
    const [resumes, setResumes] = useState<Record<string,string>>({});
    const [contexts,setContexts]=useState<Record<string,string>>({});
    const resumePosition = main ? readingPosition(main) : null;
    const resumeKey = main ? `${main.id}:${main.content_hash}:${resumePosition}` : '';
    const resumeId = main?.id, resumeHash = main?.content_hash, resumeFallback = main?.preview;
    useEffect(() => {
        if (!resumeId || resumePosition === null || !resumeHash) return;
        let active = true;
        void invoke<ReadingMaterial>('open_reading_material', {fileId:resumeId}).then(data => {
            if (active && data.material.content_hash === resumeHash) {
                const index=data.segments.findIndex(segment=>segment.index_num===resumePosition);
                setResumes(previous => ({...previous,[resumeKey]:data.segments[index]?.en_text??resumeFallback??''}));
                setContexts(previous=>({...previous,[resumeKey]:data.segments[index+1]?.en_text??''}));
            }
        }).catch(() => {});
        return () => { active = false; };
    }, [resumeKey, resumeId, resumeHash, resumeFallback, resumePosition]);
    const cardIndex = Math.max(0, desktop.findIndex(file => file.id === main?.id));
    const cardTurn = useSoftCardTurn(!library ? main?.id : null, cardIndex, desktop.length, (step: number) => {
        const target = desktop[cardIndex + step];
        if (target) useReadingDeskStore.getState().select(target);
        setMenu(null);
    });
    const shelfFit=useBookmarkDesk(cardTurn.stackRef,shelf,main?.id,Math.max(0,materials.files.length-1));
    const source = (file: Material) => file.document?.origin?.kind === 'webpage' ? file.document.origin.final_url : file.source?.title ?? (file.document?.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : t('readingDesk.localSource'));
    const format = (file: Material) => {
        const kind = file.source_kind ?? (file.source ? 'youtube' : file.document?.origin?.kind === 'webpage' ? 'webpage' : file.document?.origin?.kind === 'clipboard' ? 'clipboard' : 'file');
        if (kind === 'youtube') return 'YouTube';
        if (kind === 'webpage') return t('materials.importDialog.webpage');
        if (kind === 'clipboard') return t('materials.importDialog.clipboardText');
        return file.original_format?.toUpperCase() ?? file.document?.original_format?.toUpperCase() ?? t('readingDesk.localSource');
    };
    const term = query.trim().toLocaleLowerCase();
    const matches = materials.files.filter(file => (range === 'all' || !onDesk(file)) &&
        (!untagged || !file.tags.length) && selectedTags.every(id => file.tags.some(tag => tag.id === id)) &&
        (!term || `${file.name} ${source(file)} ${format(file)}`.toLocaleLowerCase().includes(term)));
    const remember = () => saveLibraryView({query,range,tagsOpen,tagIds:selectedTags,untagged,scroll:scrollTop.current,focusId:focusId.current,expandedId:expanded});
    const closeMenu = (id: number) => {
        setMenu(null);
        scroll.current?.querySelector<HTMLButtonElement>(`[data-material="${id}"] .library-menu > button`)?.focus({preventScroll:true});
    };
    const open = (file: Material, origin: 'desk' | 'library') => {
        cancelMotion();
        if (origin === 'library') { focusId.current=file.id; scrollTop.current=scroll.current?.scrollTop ?? 0; remember(); }
        desk.clearNotice(); navigate(`/files/${file.id}`, {state:{readingOrigin:origin}});
    };
    const archive = (file: Material) => {
        // The replacement paper occupies the same position: one double-click must not archive it too.
        const now=performance.now();
        if (now-lastArchive.current<300) return;
        lastArchive.current=now;
        cancelMotion();
        const original = paper.current, target = dock.current;
        if (original && target && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const from = original.getBoundingClientRect(), to = target.getBoundingClientRect();
            const copy = original.cloneNode(true) as HTMLElement;
            copy.classList.add('desk-flying'); copy.inert=true; copy.setAttribute('aria-hidden','true');
            copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
            Object.assign(copy.style,{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`});
            document.body.append(copy);
            const animation=copy.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${to.left+32-from.left-from.width/2}px,${to.top+to.height/2-from.top-from.height/2}px) scale(.04) rotate(3deg)`,opacity:0}],{duration:460,easing:'cubic-bezier(.22,.75,.25,1)'});
            motion.current={node:copy,animation};
            void animation.finished.catch(()=>{}).finally(()=>{copy.remove();if(motion.current?.node===copy)motion.current=null;});
        }
        desk.archive(file);
        requestAnimationFrame(()=> (paper.current?.querySelector<HTMLButtonElement>('.desk-archive') ?? dock.current)?.focus({preventScroll:true}));
    };
    const showLibrary = () => { cancelMotion(); setParams({view:'library'}); };
    const closeLibrary = () => { remember(); setParams({}, {replace:true}); };
    useSheetDrag(libraryPanel,mobileSheet && library && libraryPresent,closeLibrary);
    // Refresh metadata in place so dialog return targets and library controls stay mounted.
    const ready = materials.hasLoaded || (!materials.loading && !materials.error);
    const initialLoad = materials.loading && !materials.hasLoaded;
    const refreshIndicator = materials.loading && materials.hasLoaded &&
        <span role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></span>;
    const loadError = materials.error && <div className="saved-error" role="alert"><p>{t('materials.loadFailed')}</p><button className="ui-button" onClick={() => void materials.load()}>{t('common.retry')}</button></div>;
    return <div className="materials-page reading-stage-page" data-has-desk={!!main} data-library-open={library||undefined} data-library-restored={library&&location.state?.restoreLibrary||undefined}><div className="materials-scroll"><div className="materials-paper reading-stage-content">
        <div className="materials-heading"><h1>{t('materials.title')}</h1>{!libraryPresent && refreshIndicator}</div>
        {initialLoad && !libraryPresent && <LoadingSkeleton kind="list" label={t('common.loading')}/>}
        {!libraryPresent && loadError}
        {ready && <section className="reading-desktop" aria-label={t('readingDesk.desktop')}>
            {main ? <><div className="desk-stack" ref={cardTurn.stackRef} tabIndex={0} aria-label={t('readingDesk.desktop')}>
                <div className="desk-card-viewport">{desktop.map((file, index) => {
                  const active = file.id === main.id;
                  const position = index - cardIndex;
                  const key=`${file.id}:${file.content_hash}:${readingPosition(file)}`;
                  const excerpt=bookmarkExcerpt(resumes[key]??file.preview);
                  const context=contexts[key]??excerpt.context;
                  return <article className="desk-paper" data-desk-active={active} data-desk-position={position} aria-hidden={!active || undefined} inert={!active}
                    style={{transform:deskCardTransform(position), opacity:Math.abs(position)<=1?1:0}}
                    ref={active ? (node) => { paper.current=node; } : undefined} key={`${file.id}:${file.content_hash}`}>
                    <div className="desk-paper-top"><span>{format(file)}</span><div className="desk-card-menu"><button className="desk-text-button" aria-label={t('materials.more',{name:file.name})} aria-expanded={menu===file.id} onClick={()=>setMenu(menu===file.id?null:file.id)}><MoreHorizontal size={20}/></button>{menu===file.id && <div className="material-actions"><button className="ui-button desk-archive" onClick={()=>{setMenu(null);archive(file)}} disabled={!!deleting[file.id]}><Archive size={16}/>{t('readingDesk.archive')}</button></div>}</div></div>
                    <button type="button" className="desk-mobile-summary" aria-label={t('readingDesk.openNamed',{name:file.name})} disabled={!!deleting[file.id]} onClick={()=>open(file,'desk')}>
                      <span className="desk-mobile-title" lang="en">{bookmarkTitle(file.name)}</span><span className="desk-mobile-preview" lang="en"><span className="desk-mobile-quote-text">{excerpt.quote}</span></span>{context&&context!==excerpt.quote&&<span className="desk-mobile-context" lang="en">{context}</span>}
                    </button>
                    <h2 className="desk-desktop-title" lang="en">{file.name}</h2><div className="desk-card-tags">{file.tags.map(tag=><TagBadge key={tag.id} name={tag.name} tone={tag.tone}/>)}<button className="desk-text-button" aria-label={t('tags.edit')} onClick={()=>setEdit(file)}><Pencil size={20} aria-hidden="true"/></button></div>
                    <div className="desk-paper-bottom"><p lang="en">{resumes[`${file.id}:${file.content_hash}:${readingPosition(file)}`] ?? file.preview}</p><button className="desk-primary" data-testid="desk-continue" disabled={!!deleting[file.id]} onClick={()=>open(file,'desk')}>{t(readingPosition(file)===null?'readingDesk.start':'readingDesk.continueLabel')}</button></div>
                  </article>;
                })}</div>
                {cardIndex>0&&<button type="button" className="desk-swipe-cue desk-swipe-cue-left" data-testid="desk-swipe-prev" aria-label={t('history.previous')} onClick={()=>cardTurn.turn(-1)}><ChevronLeft size={12} strokeWidth={1.75} aria-hidden="true"/></button>}
                {cardIndex<desktop.length-1&&<button type="button" className="desk-swipe-cue desk-swipe-cue-right" data-testid="desk-swipe-next" aria-label={t('history.next')} onClick={()=>cardTurn.turn(1)}><ChevronRight size={12} strokeWidth={1.75} aria-hidden="true"/></button>}
              </div><div className="desk-pager"><button className="desk-text-button" aria-label={t('history.previous')} data-testid="desk-prev" disabled={cardIndex===0} onClick={()=>cardTurn.turn(-1)}><ChevronLeft size={20}/></button><span>{cardIndex+1} / {desktop.length}</span><button className="desk-text-button" aria-label={t('history.next')} data-testid="desk-next" disabled={cardIndex>=desktop.length-1} onClick={()=>cardTurn.turn(1)}><ChevronRight size={20}/></button></div>
            </> : <div className="desk-empty"><span className="desk-empty-symbol" aria-hidden="true">{materials.files.length?<Check size={24}/>:<FileText size={26}/>}</span><h2>{t(materials.files.length?'readingDesk.clear':'readingDesk.noMaterials')}</h2><p>{t(materials.files.length?'readingDesk.clearHint':'readingDesk.importHint')}</p><button ref={emptyImport} className="desk-primary" onClick={event=>{rememberImportFocus(event.currentTarget);useImportStore.getState().show();}}>{t('materials.import')}</button></div>}
        </section>}
        {ready && materials.files.length>0 && <div ref={shelf} className={`desk-dock-wrap${library || libraryPresent ? ' library-dock-hidden' : ''}`}><button className="desk-library-dock" ref={dock} onClick={showLibrary} aria-expanded={library} aria-label={`${t('readingDesk.library')} ${t('readingDesk.materialCount',{count:materials.files.length})}`}><span className="desk-dock-art" aria-hidden="true"><Archive size={20} strokeWidth={1.75}/></span><span><strong>{t('readingDesk.library')}</strong><small>{t('readingDesk.materialCount',{count:materials.files.length})}</small></span><ChevronsUp size={20} strokeWidth={1.75} aria-hidden="true"/></button><div className="desk-shelf-previews" aria-label={t('readingDesk.library')}>
            {materials.files.slice(0,5).map((file,index)=>{const othersBefore=materials.files.slice(0,index).filter(item=>item.id!==main?.id).length;const visible=file.id!==main?.id&&othersBefore<shelfFit.count;return <div className="desk-shelf-row" key={file.id} data-visible={visible} inert={!visible} aria-hidden={!visible||undefined}><div><button className="desk-shelf-open" disabled={!!deleting[file.id]} onClick={()=>open(file,'desk')} aria-label={t('readingDesk.openNamed',{name:file.name})}><span><strong lang="en">{bookmarkTitle(file.name)}</strong><small lang="en">{file.preview}</small></span><BookOpen size={20} strokeWidth={1.75} aria-hidden="true"/></button></div></div>;})}
        </div><DeskFeedback beforeUndo={()=>{cancelMotion();lastArchive.current=-Infinity;}}/></div>}
        {ready && !materials.files.length && <DeskFeedback/>}
    </div></div>
        {libraryPresent && <Overlay panelRef={libraryPanel} returnFocus={libraryReturnTarget} initialFocus={()=>{const target=location.state?.restoreLibrary&&focusId.current?scroll.current?.querySelector<HTMLButtonElement>(`[data-open="${focusId.current}"]`):null;return target??(mobileSheet?libraryPanel.current:null);}} label={t('readingDesk.library')} onClose={closeLibrary} className="library-overlay-panel" layerClassName={`library-overlay-layer${mobileSheet ? ' is-mobile-sheet' : ''}${library ? '' : ' is-closing'}${location.state?.restoreLibrary ? ' is-restoring' : ''}`}><div className="library-sheet-grab" aria-hidden="true"><span/></div><div ref={scroll} className="library-overlay-scroll" inert={!library} onScroll={() => { scrollTop.current=scroll.current?.scrollTop ?? 0; remember(); }}><section className="reading-library" aria-label={t('readingDesk.library')}>
            <DeskFeedback/>
            <div className="library-heading"><h2>{t('readingDesk.library')}</h2>{refreshIndicator}<button className="desk-text-button desk-icon-button" onClick={closeLibrary} aria-label={t('readingDesk.backDesk')} title={t('readingDesk.backDesk')}><X size={20} aria-hidden="true"/></button></div>
            {initialLoad && <LoadingSkeleton kind="list" label={t('common.loading')}/>}
            {loadError}
            {ready && <><div className="library-tools"><div className="library-ranges" role="group" aria-label={t('readingDesk.range')}>
                {(['all','stored'] as const).map(value=><button key={value} className="desk-text-button" aria-pressed={range===value} onClick={()=>{setRange(value);scrollTop.current=0;}}>{t(value==='all'?'readingDesk.all':'readingDesk.stored')} <span>{value==='all'?materials.files.length:materials.files.filter(file=>!onDesk(file)).length}</span></button>)}
            </div><label className="library-search"><Search size={17} aria-hidden="true"/><input ref={search} type="search" aria-label={t('readingDesk.search')} placeholder={t('readingDesk.search')} value={query} onChange={event=>{setQuery(event.target.value);scrollTop.current=0;}}/></label><button className="desk-text-button library-tag-toggle" aria-label={t('materials.filterTags')} aria-expanded={tagsOpen} onClick={()=>setTagsOpen(!tagsOpen)}><Tags size={18} aria-hidden="true"/></button></div>
            {tagsOpen && <TagFilterBar onManage={()=>setManager(true)}/>}
            <p className="library-result-count sr-only" role="status">{t('readingDesk.results',{count:matches.length})}</p>
            <MotionChange className={menu !== null ? 'library-menu-open' : ''} changeKey={`${query}:${range}:${selectedTags.join(',')}:${untagged}:${matches.map(file => file.id).join(',')}`}><div className={`library-list${menu !== null ? ' has-open-menu' : ''}`}>{matches.slice(0, visibleCount).map(file=><article className="library-row" key={file.id} data-material={file.id} data-menu-open={menu===file.id}>
                <div className="library-copy"><button className="library-preview-toggle" aria-expanded={expanded===file.id} onClick={()=>setExpanded(expanded===file.id?null:file.id)}><h3>{file.name}</h3></button>{file.tags.length>0 && <div className="material-tags">{file.tags.map(tag=><TagBadge key={tag.id} name={tag.name} tone={tag.tone}/>)}</div>}<div className="library-preview" data-open={expanded===file.id} inert={expanded!==file.id} aria-hidden={expanded!==file.id}><div><p lang="en">{file.preview}</p></div></div></div>
                <button className="desk-text-button desk-icon-button library-open" title={t('readingDesk.openNamed',{name:file.name})} data-open={file.id} aria-label={t('readingDesk.openNamed',{name:file.name})} disabled={!!deleting[file.id]} onClick={()=>open(file,'library')}><BookOpen size={20} aria-hidden="true"/></button>
                <div className="library-menu"><button className="desk-text-button" aria-label={t('materials.more',{name:file.name})} aria-expanded={menu===file.id} onClick={()=>setMenu(menu===file.id?null:file.id)}><MoreHorizontal size={19} aria-hidden="true"/></button>{menu===file.id && <div className="material-actions"><button className="ui-button" onClick={()=>{closeMenu(file.id);setEdit(file);}}><Tags size={16} aria-hidden="true"/>{t('tags.edit')}</button><button className="ui-button" onClick={()=>{closeMenu(file.id);if(onDesk(file)) desk.archive(file); else desk.keep(file);}}><Archive size={16} aria-hidden="true"/>{t(onDesk(file) ? 'readingDesk.archive' : 'readingDesk.keep')}</button></div>}</div>
                {deleting[file.id] && <p role="status">{t('fileStore.deleting')}</p>}
            </article>)}</div></MotionChange>
            {visibleCount < matches.length && <button className="ui-button" onClick={()=>setVisibleCount(value=>{sessionLibraryCount=value+30;return sessionLibraryCount;})}>{t('savedRecords.loadMore')}</button>}
            {!matches.length && <div className="library-no-results" role="status"><p>{t(materials.files.length?'materials.noMatches':'materials.empty')}</p>{materials.files.length > 0 && <button className="ui-button" onClick={()=>{setQuery('');setRange('all');useFileStore.getState().setTagFilter([],false);}}>{t('readingDesk.resetFilters')}</button>}</div>}
        </>}</section></div></Overlay>}
        {manager && <TagManager onClose={()=>{setManager(false);materials.changed();}}/>}{edit && <TagEditDialog file={edit} onClose={()=>{setEdit(null);materials.changed();}}/>}
    </div>;
}
