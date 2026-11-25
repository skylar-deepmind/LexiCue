import ImportMaterialCard from './ImportMaterialCard';
import { captureImportInsertion, finishImportInsertion } from '../lib/importInsertion';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { invoke } from '@tauri-apps/api/core';
import type { ReadingMaterial } from '../lib/materials';
import { visitState } from '../lib/pageNavigation';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, FileText, X } from 'lucide-react';
import Overlay from './Overlay';
import MotionChange from './MotionChange';
import { takeImportFocus } from './importFocus';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import ImportPaper from './ImportPaper';
import YouTubeImportLoading from './YouTubeImportLoading';
import type { MaterialDropPoint } from './useMaterialDrop';
import { useImportPresence } from './useImportPresence';
import { useYouTubeLanding } from './useYouTubeLanding';
import { classifyImportLink } from '../lib/importLink';
import { authorizeImportedReading, validateImportedReading, consumeImportedReading } from '../lib/readingEntry';
import '../import.css';

export default function ImportPanel({ dropOrigin }: { dropOrigin: RefObject<MaterialDropPoint | null> }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location=useLocation();
    const live = useImportStore();
    const panelRef = useRef<HTMLDivElement>(null);
    const linkInput = useRef<HTMLInputElement>(null);
    const previous = useRef(live);
    if (live.open) previous.current = live;
    const state = live.open ? live : previous.current;
    const { destination, running, hide, clearDestination, phase } = state;
    const open = live.open;
    const present = useImportPresence(open, panelRef);
    useYouTubeLanding(open, phase, panelRef);
    const youtubeItem = state.items.length === 1 && state.items[0].kind === 'youtube' ? state.items[0] : null;
    const youtubeImport = !!youtubeItem;
    const [paperPainted, setPaperPainted] = useState(false);
    const finishingPaper = open && !youtubeImport && paperPainted && phase === 'preview' && state.items.some(item => item.stage === 'ready')
        && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const preparing = phase === 'preparing' || finishingPaper;
    useLayoutEffect(() => {
        if (open && phase === 'preparing' && !youtubeImport) {
            setPaperPainted(true);
        } else if (finishingPaper) {
            // The draft is already available. Let the paper land before
            // swapping the overlay content; parsing and writes never wait.
            const timer = setTimeout(() => setPaperPainted(false), 250);
            return () => clearTimeout(timer);
        } else {
            setPaperPainted(false);
        }
    }, [open, phase, finishingPaper, youtubeImport]);
    const placing = useRef(false), placed = useRef(new Set<string>());
    const tags = useFileStore(s => s.tags);
    const loadTags = useFileStore(s => s.loadTags);
    useEffect(() => { if (live.open) void loadTags(); }, [live.open, loadTags]);
    const importedNewTag = live.phase === 'result' && live.importTags.newTagNames.length > 0 && live.items.some(item => item.stage === 'created');
    useEffect(() => { if (importedNewTag) void loadTags(true); }, [importedNewTag, loadTags]);
    useEffect(() => {
        if (!live.open || destination === null || running || placing.current) return;
        placing.current=true;
        const owner=useImportStore.getState();
        void (async()=>{
            const created=owner.items.filter(item=>item.stage==='created'&&item.result?.readable&&item.draft&&!placed.current.has(item.draft.operation_id));
            if(!created.length){clearDestination();return;}
            const preferred=created.find(item=>item.id===owner.selectedId)??created.at(-1);
            const ordered=[...created.filter(item=>item!==preferred),...(preferred?[preferred]:[])];
            const materials: ReadingMaterial['material'][] = [];
            for(const item of ordered){
                const token=authorizeImportedReading(item);
                const data=await invoke<ReadingMaterial>('open_reading_material',{fileId:item.result!.file_id});
                if(token&&await validateImportedReading(token,data)&&consumeImportedReading(token))materials.push(data.material);
            }
            await useMaterialStore.getState().ensure();
            if(!useImportStore.getState().open||useImportStore.getState().destination!==destination)return;
            const target=materials.at(-1);
            const incomplete=owner.items.some(item=>['failed','cancelled','duplicate'].includes(item.stage));
            const flight=target&&!incomplete?captureImportInsertion(panelRef.current?.querySelector<HTMLElement>('.import-material-card')??null):null;
            // Keep the painted preview in front while mounting the new desk
            // card. Commit placement and dismissal in the same paint.
            flushSync(() => {
                clearDestination();
                for(const material of materials){useReadingDeskStore.getState().keepAndOpen(material);const item=created.find(row=>row.result?.file_id===material.id);if(item?.draft)placed.current.add(item.draft.operation_id);}
                navigate('/files');
                if(!incomplete)hide();
            });
            if(target)void finishImportInsertion(flight,target.id);
        })().catch(()=>{clearDestination();useFeedbackStore.getState().show(t('materials.loadFailed'),'error');}).finally(()=>{placing.current=false;});
    }, [live.open, destination, running, hide, clearDestination, navigate, t]);
    useLayoutEffect(() => {
        if (!open) return;
        const viewport = window.visualViewport;
        const layer = panelRef.current?.parentElement;
        if (!viewport || !layer) return;
        const resize = () => { layer.style.top = `${viewport.offsetTop}px`; layer.style.height = `${viewport.height}px`; layer.style.bottom = 'auto'; };
        resize(); viewport.addEventListener('resize', resize); viewport.addEventListener('scroll', resize);
        return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); };
    }, [open]);
    // When a stage removes the focused control, keep keyboard ownership in the dialog.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (open && panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }, [open, phase, preparing]);
    if (!present) return null;
    if (phase === 'source') return <Overlay returnFocus={takeImportFocus}
        label={t('materials.importDialog.linkTitle')} onClose={hide} panelRef={panelRef}
        initialFocus={() => linkInput.current} className="lc-import-modal"
        layerClassName={`lc-import-layer${open ? '' : ' lc-import-layer--closing'}`}>
        <LinkImportForm input={linkInput} onClose={hide} />
    </Overlay>;
    const committing = phase === 'committing';
    const preview = phase === 'preview';
    const result = phase === 'result';
    const valid = state.items.filter(item => item.stage === 'ready');
    const processed = state.items.filter(item => ['created', 'duplicate', 'failed', 'cancelled'].includes(item.stage)).length;
    const selected = state.items.find(item => item.id === state.selectedId && item.draft) ?? state.items.find(item => item.draft);
    const retryable = state.items.some(item => item.stage === 'failed' && !['invalid_format', 'invalid_document', 'unsupported', 'password', 'encrypted', 'no_text', 'invalid_encoding', 'too_large', 'english_only', 'zip_limit', 'empty_package', 'ambiguous_package', 'package_audio'].includes(item.error ?? '') && (result ? !!item.draft : item.englishFallback === undefined || !!item.fallbackSegments) || result && item.stage === 'cancelled' && !!item.draft);
    const heading = preview ? 'previewTitle' : committing ? 'writingTitle' : 'resultTitle';
    const layer = `lc-import-layer${open ? '' : ' lc-import-layer--closing'}`;
    if (preparing) return <Overlay returnFocus={takeImportFocus} label={t('materials.importDialog.preparingTitle')}
        onClose={() => { if (useImportStore.getState().phase === 'preparing') state.cancel(); else hide(); }}
        dismissOnBackdrop={false} className="lc-import-modal lc-import-preparing"
        layerClassName={`${layer} lc-import-preparing-layer`} panelRef={panelRef}>
        {youtubeItem ? <YouTubeImportLoading disabled={!open} item={youtubeItem} />
            : <ImportPaper disabled={!open || finishingPaper} finishing={finishingPaper} items={state.items}
                dropOrigin={dropOrigin.current} />}
    </Overlay>;
    if (selected?.draft && (preview || committing || result)) {
        return <Overlay returnFocus={takeImportFocus} label={t('materials.import')} onClose={hide}
            className="lc-import-modal import-card-modal"
            layerClassName={`${layer}${youtubeItem ? ' lc-import-youtube-layer' : ''}`} panelRef={panelRef}>
            <ImportMaterialCard item={selected} items={state.items} tags={tags} tagSelection={state.importTags} phase={phase}
                busy={running || !!state.selectionBusy} canConfirm={valid.length > 0 && !state.selectionBusy}
                retryable={retryable} onClose={hide} onConfirm={()=>void state.confirm()} onRetry={()=>void state.retry()} />
        </Overlay>;
    }
    return <Overlay returnFocus={takeImportFocus} label={t('materials.import')} onClose={hide}
        className="lc-import-modal" layerClassName={layer} panelRef={panelRef}>
        <header className="lc-import-header">
            <h2>{t(`materials.importDialog.${heading}`)}</h2>
            <button className="ui-button ui-button--icon lc-import-close" aria-label={t(committing ? 'materials.importDialog.minimize' : 'common.close')} onClick={hide}><X size={20} aria-hidden="true" /></button>
        </header>
        <MotionChange changeKey={phase} resizeContainer=".lc-import-modal"><div className="lc-import-body">
            {state.pickerError && <p className="lc-import-error" role="alert">{t('materials.importDialog.pickerFailed')}</p>}
            {(preview || result || committing) && <>
                <p className="lc-import-summary" role="status">{committing ? t(state.stopping ? 'materials.stopping' : 'materials.processing', { done: processed, total: state.items.length }) : result ? t('materials.finished', { count: state.items.filter(item => item.stage === 'created').length }) : t('materials.importDialog.readyCount', { count: valid.length, total: state.items.length })}</p>
                {(state.items.length > 1 || !preview || !selected) && <ul className="lc-import-items">{state.items.map(item => <li key={item.id}>
                    {preview && item.draft ? <button className="lc-import-item-select" aria-pressed={selected?.id === item.id} onClick={() => state.select(item.id)}><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span><Check size={18} aria-hidden="true" /></button> : <div className="lc-import-item-status"><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span>{item.stage === 'created' && <Check size={18} aria-hidden="true" />}</div>}
                    {item.error && item.stage === 'failed' && <p className="lc-import-error" role="alert">{t(
                        item.error === 'youtube_tool_missing' ? 'materials.importDialog.youtubeToolsRequired'
                        : item.error === 'youtube_no_subtitles' ? 'materials.noEnglishSubtitles' : `materials.errors.${item.error}`
                    )}</p>}
                    {item.englishFallback !== undefined && <button className="ui-button" onClick={() => void state.useEnglish(item.id)}>{t('materials.englishFallback')}</button>}
                    {item.result?.outcome === 'duplicate' && <button className="ui-button" onClick={() => { state.hide(); navigate(item.result!.readable ? `/files/${item.result!.file_id}` : `/legacy?fileId=${item.result!.file_id}`,{state:{...visitState(location),reopenImport:true}}); }}>{t('materials.openExisting')}</button>}
                </li>)}</ul>}
                {retryable && <button className="ui-button" onClick={() => void state.retry()} disabled={running}>{t('materials.retryFailed')}</button>}
                {preview && !selected && state.items.some(item => item.kind === 'webpage' || item.kind === 'youtube') && <button className="ui-button" onClick={state.showLink}>{t('materials.importDialog.linkTitle')}</button>}
            </>}
        </div></MotionChange>
        <footer className="lc-import-footer">
            {committing ? <><p>{t('materials.importDialog.backgroundHint')}</p><button className="ui-button" disabled={state.stopping} onClick={state.cancel}>{t('materials.cancelRemaining')}</button></> : preview ? <><button className="ui-button ui-button--icon" aria-label={t('materials.importDialog.changeSource')} title={t('materials.importDialog.changeSource')} onClick={() => void state.choose()}><FileText size={20} aria-hidden="true" /></button>{valid.length > 0 && <button className="ui-button lc-import-primary" disabled={!valid.length || !!state.selectionBusy} onClick={() => void state.confirm()}>{t(valid.some(item => item.draft?.document?.extraction_status === 'partial') ? 'documents.importPartial' : 'materials.importDialog.confirm', { count: valid.length })}</button>}</> : <><button className="ui-button" onClick={() => void state.choose()}>{t('materials.importDialog.importMore')}</button><button className="ui-button ui-button--icon lc-import-primary" aria-label={t('common.close')} title={t('common.close')} onClick={hide}><X size={20} aria-hidden="true" /></button></>}
        </footer>
    </Overlay>;
}

function LinkImportForm({ input, onClose }: {
    input: RefObject<HTMLInputElement | null>;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const label = t('materials.importDialog.linkTitle');
    return <>
        <header className="lc-import-header">
            <h2>{label}</h2>
            <button type="button" className="ui-button ui-button--icon lc-import-close" aria-label={t('common.close')} onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="lc-import-body lc-import-youtube">
            <form noValidate onSubmit={event => {
                event.preventDefault();
                const link = classifyImportLink(input.current?.value ?? '');
                if ('error' in link) { setError(link.error); input.current?.focus(); return; }
                void useImportStore.getState().fromContent(link.kind, link.url);
            }}>
                <label htmlFor="lc-import-link">{t('materials.importDialog.linkLabel')}</label>
                <input id="lc-import-link" ref={input} type="url" autoComplete="off" placeholder="https://…"
                    aria-invalid={!!error} aria-describedby={error ? 'lc-import-link-error' : undefined}
                    onChange={() => { if (error) setError(''); }} />
                {error && <p id="lc-import-link-error" className="lc-import-error" role="alert">{t(`materials.importDialog.${error}`)}</p>}
                <button className="ui-button lc-import-primary">{t('materials.importDialog.analyzeLink')}</button>
            </form>
        </div>
    </>;
}
