import ImportMaterialCard from './ImportMaterialCard';
import { captureImportInsertion, finishImportInsertion } from '../lib/importInsertion';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { invoke } from '@tauri-apps/api/core';
import type { ReadingMaterial } from '../lib/materials';
import { visitState } from '../lib/pageNavigation';
import { BusyRing } from './LoadingFeedback';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ClipboardPaste, FileText, X } from 'lucide-react';
import Overlay from './Overlay';
import ClipboardScene from './ClipboardScene';
import MotionChange from './MotionChange';
import { takeImportFocus } from './importFocus';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import ImportPaper from './ImportPaper';
import { readImportClipboard } from '../lib/importLink';
import { inspectClipboardContent } from '../lib/clipboardContent';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useImportPresence } from './useImportPresence';
import { authorizeImportedReading, validateImportedReading, consumeImportedReading } from '../lib/readingEntry';
import '../import.css';

export default function ImportPanel() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location=useLocation();
    const live = useImportStore();
    const panelRef = useRef<HTMLDivElement>(null);
    const previous = useRef(live);
    if (live.open) previous.current = live;
    const state = live.open ? live : previous.current;
    const { destination, running, hide, clearDestination, phase, source } = state;
    const [readingClipboard, setReadingClipboard] = useState(false);
    const [inputError, setInputError] = useState<string | null>(null);
    const [manualInput, setManualInput] = useState<string | null>(null);
    const scene = live.open && live.presentation === 'scene';
    const open = !scene && live.open;
    const present = useImportPresence(open, panelRef, live.presentation==='scene');
    const clipboardRequest = useRef(0);
    const reading = useRef(false), placing = useRef(false), placed = useRef(new Set<string>());
    const invalidateClipboard = useCallback((refresh = true) => {
        clipboardRequest.current++; reading.current = false;
        if (refresh) setReadingClipboard(false);
    }, []);
    useEffect(() => {
        if (!present && !live.open) { previous.current = live; setInputError(null); setManualInput(null); }
    }, [present, open, live]);
    useEffect(() => {
        const unsubscribe = useImportStore.subscribe((next, before) => {
            if (before.open && !next.open) {
                setInputError(null);
                setManualInput(null);
            }
            if (!next.open || next.source !== before.source || next.phase !== before.phase) {
                invalidateClipboard();
            }
        });
        return () => { unsubscribe(); invalidateClipboard(false); };
    }, [invalidateClipboard]);
    const acceptContent = async (text: string | null, fromChooser = false) => {
        const result = inspectClipboardContent(text);
        if (result.kind === 'error') { setInputError(result.error); setManualInput(result.input.trim() ? result.input : null); return; }
        setInputError(null); setManualInput(null);
        await useImportStore.getState().fromContent(result.kind === 'text' ? 'clipboard' : 'webpage', result.kind === 'text' ? result.text : result.url, fromChooser || useImportStore.getState().presentation==='scene');
    };
    useEffect(() => {
        const accept = (event: Event) => {
            const text = (event as CustomEvent<string | null>).detail;
            if (text === null) { setInputError('clipboardFailed'); setManualInput(''); }
            else void acceptContent(text);
        };
        window.addEventListener('lexicue-import-content', accept);
        return () => window.removeEventListener('lexicue-import-content', accept);
    });
    const tags = useFileStore(s => s.tags);
    const loadTags = useFileStore(s => s.loadTags);
    useEffect(() => { if (live.open) void loadTags(); }, [live.open, loadTags]);
    const importedNewTag = live.phase === 'result' && live.importTags.newTagNames.length > 0 && live.items.some(item => item.stage === 'created');
    useEffect(() => { if (importedNewTag) void loadTags(true); }, [importedNewTag, loadTags]);
    const pasteLink = async () => {
        if (reading.current) return;
        const owner = useImportStore.getState();
        const token = ++clipboardRequest.current;
        reading.current = true; setReadingClipboard(true);
        try {
            const text = await readImportClipboard();
            if (token !== clipboardRequest.current || !useImportStore.getState().open) return;
            reading.current = false; setReadingClipboard(false);
            await acceptContent(text, owner.phase === 'source');
        } catch {
            if (token === clipboardRequest.current && owner.open) {setInputError('clipboardFailed'); setManualInput('');}
        } finally { if (token === clipboardRequest.current) {reading.current = false; setReadingClipboard(false);} }
    };
    useEffect(() => {
        if (!live.open || destination === null || running || placing.current) return;
        placing.current=true;
        const owner=useImportStore.getState();
        void (async()=>{
            const created=owner.items.filter(item=>item.stage==='created'&&item.result?.readable&&item.draft&&!placed.current.has(item.draft.operation_id));
            if(!created.length){clearDestination();return;}
            const preferred=created.find(item=>item.id===owner.selectedId)??created.at(-1);
            const ordered=[...created.filter(item=>item!==preferred),...(preferred?[preferred]:[])];
            const materials=[];
            for(const item of ordered){
                const token=authorizeImportedReading(item);
                const data=await invoke<ReadingMaterial>('open_reading_material',{fileId:item.result!.file_id});
                if(token&&await validateImportedReading(token,data)&&consumeImportedReading(token))materials.push(data.material);
            }
            await useMaterialStore.getState().load();
            if(!useImportStore.getState().open||useImportStore.getState().destination!==destination)return;
            clearDestination();
            for(const material of materials){useReadingDeskStore.getState().keepAndOpen(material);const item=created.find(row=>row.result?.file_id===material.id);if(item?.draft)placed.current.add(item.draft.operation_id);}
            const target=materials.at(-1);
            const incomplete=owner.items.some(item=>['failed','cancelled','duplicate'].includes(item.stage));
            const flight=target&&!incomplete?captureImportInsertion(document.querySelector<HTMLElement>('.import-material-card')):null;
            if(!incomplete)hide();
            navigate('/files');
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
    }, [open, phase, source]);
    if (!present && !scene) return null;
    const compact = phase === 'source' && manualInput === null;
    const preparing = phase === 'preparing';
    const committing = phase === 'committing';
    const preview = phase === 'preview';
    const result = phase === 'result';
    const valid = state.items.filter(item => item.stage === 'ready');
    const processed = state.items.filter(item => ['created', 'duplicate', 'failed', 'cancelled'].includes(item.stage)).length;
    const active = state.items.find(item => ['reading', 'downloading', 'parsing', 'translating', 'writing'].includes(item.stage));
    const selected = state.items.find(item => item.id === state.selectedId && item.draft) ?? state.items.find(item => item.draft);
    const retryable = state.items.some(item => item.stage === 'failed' && !['invalid_format', 'invalid_document', 'unsupported', 'password', 'encrypted', 'no_text', 'invalid_encoding', 'too_large', 'english_only', 'zip_limit', 'empty_package', 'ambiguous_package', 'package_audio'].includes(item.error ?? '') && (result ? !!item.draft : item.englishFallback === undefined || !!item.fallbackSegments) || result && item.stage === 'cancelled' && !!item.draft);
    const heading = preview ? 'previewTitle' : preparing ? 'preparingTitle' : committing ? 'writingTitle' : result ? 'resultTitle' : 'title';
    if(selected?.draft && (preview||committing||result)) {
        const card=<ImportMaterialCard item={selected} items={state.items} tags={tags} tagSelection={state.importTags} phase={phase} busy={running||!!state.selectionBusy} canConfirm={valid.length>0&&!state.selectionBusy} retryable={retryable} onClose={hide} onConfirm={()=>void state.confirm()} onRetry={()=>void state.retry()}/>;
        return scene?<ClipboardScene returnFocus={takeImportFocus} label={t('materials.importDialog.previewTitle')} onClose={hide}>{card}</ClipboardScene>:<Overlay returnFocus={takeImportFocus} label={t('materials.import')} onClose={hide} className="lc-import-modal import-card-modal" layerClassName={`lc-import-layer${open?'':' lc-import-layer--closing'}`} panelRef={panelRef}>{card}</Overlay>;
    }
    if(scene)return <ClipboardScene returnFocus={takeImportFocus} label={t('approved.recognizing')} onClose={hide}>
          <div className="clipboard-recognition-art" data-running={running||undefined} aria-hidden="true"><span/><span/><span/><i/></div>
          {running? <p role="status"><BusyRing/>{t(committing?'materials.importDialog.writingTitle':'approved.recognizing')}</p>:<div role="status">{state.items.map(item=><div key={item.id}>{item.error&&<p>{t(`materials.errors.${item.error}`)}</p>}{item.englishFallback!==undefined&&<button className="ui-button" onClick={()=>void state.useEnglish(item.id)}>{t('materials.englishFallback')}</button>}{item.result?.outcome==='duplicate'&&<><p>{t('materials.stages.duplicate')}</p><button className="ui-button" onClick={()=>{hide();navigate(`/files/${item.result!.file_id}`,{state:{readingOrigin:'desk'}});}}>{t('materials.openExisting')}</button></>}</div>)}{retryable&&<button className="ui-button" onClick={()=>void state.retry()}>{t('common.retry')}</button>}</div>}
        <button className="clipboard-scene-cancel" onClick={running?state.cancel:hide}>{t(running?'common.cancel':'common.close')}</button>
    </ClipboardScene>;
    return <Overlay returnFocus={takeImportFocus} label={t('materials.import')} onClose={hide} className={`lc-import-modal${compact ? ' lc-import-modal--compact' : ''}`} layerClassName={`lc-import-layer${open ? '' : ' lc-import-layer--closing'}`} panelRef={panelRef}>
        <header className="lc-import-header">
            <h2>{compact ? t('materials.import') : t(`materials.importDialog.${heading}`)}</h2>
            <button className="ui-button ui-button--icon lc-import-close" aria-label={t(committing ? 'materials.importDialog.minimize' : 'common.close')} onClick={hide}><X size={20} aria-hidden="true" /></button>
        </header>
        <MotionChange changeKey={`${phase}:${source}`} resizeContainer=".lc-import-modal"><div className="lc-import-body">
            {phase === 'source' && <div className="lc-import-sources">
                <button type="button" className="ui-button lc-import-primary" disabled={state.picking || readingClipboard}
                    aria-busy={state.picking} onClick={() => void state.choose()}><FileText size={18} aria-hidden="true"/>{t('materials.choose')}</button>
                <button type="button" className="ui-button" disabled={state.picking || readingClipboard}
                    aria-busy={readingClipboard} onClick={() => void pasteLink()}><ClipboardPaste size={18} aria-hidden="true"/>{t('materials.importDialog.pasteLink')}</button>
            </div>}
            {(inputError || manualInput !== null) && (phase === 'source' || preview && !selected) && <div className="lc-content-input">
                {manualInput !== null && phase !== 'source' && <button type="button" className="ui-button" disabled={readingClipboard} aria-busy={readingClipboard} onClick={() => void pasteLink()}><ClipboardPaste size={18} aria-hidden="true"/>{t('materials.importDialog.pasteLink')}</button>}
                {inputError && <p className="lc-import-error" role="alert">{t(`materials.importDialog.${inputError}`)}</p>}
                {manualInput !== null && <form onSubmit={event => {event.preventDefault(); void acceptContent(manualInput);}}>
                    <label htmlFor="lc-manual-content">{t('materials.importDialog.manualContent')}</label>
                    <textarea id="lc-manual-content" value={manualInput} onChange={event => setManualInput(event.target.value)} rows={5} />
                    <button className="ui-button lc-import-primary" disabled={!manualInput.trim() || running}>{t('materials.importDialog.previewContent')}</button>
                </form>}
            </div>}
            {preview && !selected && state.items.some(item => item.kind === 'webpage' || item.kind === 'clipboard') && <div className="lc-content-recovery">
                <button className="ui-button lc-import-primary" disabled={readingClipboard} onClick={() => void pasteLink()}>{t('materials.importDialog.pasteBody')}</button>
                {state.items[0]?.kind === 'clipboard' && <button className="ui-button" onClick={() => setManualInput(state.items[0].capturedText ?? '')}>{t('materials.importDialog.manualContent')}</button>}
                {state.items[0]?.kind === 'webpage' && <button className="ui-button" onClick={() => void openUrl(state.items[0].url!).catch(() => setInputError('openFailed'))}>{t('materials.importDialog.openPage')}</button>}
            </div>}
            {state.pickerError && <p className="lc-import-error" role="alert">{t('materials.importDialog.pickerFailed')}</p>}
            {preparing && <ImportPaper item={active} loading/>}
            {(preview || result || committing) && <>
                <p className="lc-import-summary" role="status">{committing ? t(state.stopping ? 'materials.stopping' : 'materials.processing', { done: processed, total: state.items.length }) : result ? t('materials.finished', { count: state.items.filter(item => item.stage === 'created').length }) : t('materials.importDialog.readyCount', { count: valid.length, total: state.items.length })}</p>
                {(state.items.length > 1 || !preview || !selected) && <ul className="lc-import-items">{state.items.map(item => <li key={item.id}>
                    {preview && item.draft ? <button className="lc-import-item-select" aria-pressed={selected?.id === item.id} onClick={() => state.select(item.id)}><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span><Check size={18} aria-hidden="true" /></button> : <div className="lc-import-item-status"><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span>{item.stage === 'created' && <Check size={18} aria-hidden="true" />}</div>}
                    {item.error && item.stage === 'failed' && <p className="lc-import-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
                    {item.englishFallback !== undefined && <button className="ui-button" onClick={() => void state.useEnglish(item.id)}>{t('materials.englishFallback')}</button>}
                    {item.result?.outcome === 'duplicate' && <button className="ui-button" onClick={() => { state.hide(); navigate(item.result!.readable ? `/files/${item.result!.file_id}` : `/legacy?fileId=${item.result!.file_id}`,{state:{...visitState(location),reopenImport:true}}); }}>{t('materials.openExisting')}</button>}
                </li>)}</ul>}
                {retryable && <button className="ui-button" onClick={() => void state.retry()} disabled={running}>{t('materials.retryFailed')}</button>}
            </>}
        </div></MotionChange>
        {(preparing || preview || committing || result) && <footer className="lc-import-footer">
            {preparing ? <><button className="ui-button" onClick={state.cancel}>{t('common.cancel')}</button></> : committing ? <><p>{t('materials.importDialog.backgroundHint')}</p><button className="ui-button" disabled={state.stopping} onClick={state.cancel}>{t('materials.cancelRemaining')}</button></> : preview ? <><button className="ui-button ui-button--icon" aria-label={t('materials.importDialog.changeSource')} title={t('materials.importDialog.changeSource')} onClick={() => void state.choose()}><FileText size={20} aria-hidden="true" /></button>{valid.length > 0 && <button className="ui-button lc-import-primary" disabled={!valid.length || !!state.selectionBusy} onClick={() => void state.confirm()}>{t(valid.some(item => item.draft?.document?.extraction_status === 'partial') ? 'documents.importPartial' : 'materials.importDialog.confirm', { count: valid.length })}</button>}</> : <><button className="ui-button" onClick={() => void state.choose()}>{t('materials.importDialog.importMore')}</button><button className="ui-button ui-button--icon lc-import-primary" aria-label={t('common.close')} title={t('common.close')} onClick={hide}><X size={20} aria-hidden="true" /></button></>}
        </footer>}
    </Overlay>;
}
