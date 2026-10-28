import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, ClipboardPaste, FileText, Upload, X } from 'lucide-react';
import Overlay from './Overlay';
import { useImportStore } from '../stores/importStore';
import YouTubeImport from './YouTubeImport';
import ImportPaper from './ImportPaper';
import { inspectImportLink, readImportClipboard, type ImportLinkError } from '../lib/importLink';
import { useImportPresence } from './useImportPresence';
import '../import.css';

export default function ImportPanel() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const live = useImportStore();
    const panelRef = useRef<HTMLDivElement>(null);
    const present = useImportPresence(live.open, panelRef);
    const previous = useRef(live);
    if (live.open) previous.current = live;
    const state = live.open ? live : previous.current;
    const { open } = live;
    const { destination, running, hide, clearDestination, phase, source } = state;
    const [readingClipboard, setReadingClipboard] = useState(false);
    const [linkDraft, setLinkDraft] = useState<{ url: string; autoSearch: boolean; error?: ImportLinkError | 'clipboardFailed'; id: number } | null>(null);
    const clipboardRequest = useRef(0);
    const reading = useRef(false);
    const invalidateClipboard = useCallback((refresh = true) => {
        clipboardRequest.current++; reading.current = false;
        if (refresh) setReadingClipboard(false);
    }, []);
    useEffect(() => {
        if (!present && !open) { previous.current = live; setLinkDraft(null); }
    }, [present, open, live]);
    useEffect(() => {
        const unsubscribe = useImportStore.subscribe((next, before) => {
            if (!next.open || next.source !== before.source || next.phase !== before.phase) {
                invalidateClipboard();
            }
        });
        return () => { unsubscribe(); invalidateClipboard(false); };
    }, [invalidateClipboard]);
    const pasteLink = async () => {
        if (reading.current) return;
        const owner = useImportStore.getState();
        const token = ++clipboardRequest.current;
        reading.current = true; setReadingClipboard(true);
        let draft: Omit<NonNullable<typeof linkDraft>, 'id'>;
        try {
            const result = inspectImportLink(await readImportClipboard());
            draft = { url: result.url, autoSearch: !result.error, error: result.error };
        } catch { draft = { url: '', autoSearch: false, error: 'clipboardFailed' }; }
        if (token !== clipboardRequest.current || useImportStore.getState() !== owner || !owner.open) return;
        reading.current = false; setReadingClipboard(false);
        setLinkDraft({ ...draft, id: token });
        owner.changeSource('youtube');
    };
    useEffect(() => {
        if (!open || destination === null || running) return;
        if (destination === 'materials') { clearDestination(); navigate('/files'); }
        else { hide(); navigate(`/files/${destination}`); }
    }, [open, destination, running, hide, clearDestination, navigate]);
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
    if (!present) return null;
    const compact = phase === 'source' && source === 'choose';
    const preparing = phase === 'preparing';
    const committing = phase === 'committing';
    const preview = phase === 'preview';
    const result = phase === 'result';
    const valid = state.items.filter(item => item.stage === 'ready');
    const processed = state.items.filter(item => ['created', 'duplicate', 'failed', 'cancelled'].includes(item.stage)).length;
    const active = state.items.find(item => ['reading', 'downloading', 'parsing', 'translating', 'writing'].includes(item.stage));
    const selected = state.items.find(item => item.id === state.selectedId && item.draft) ?? state.items.find(item => item.draft);
    const retryable = state.items.some(item => item.stage === 'failed' && (result ? !!item.draft : item.englishFallback === undefined || !!item.fallbackSegments) || result && item.stage === 'cancelled' && !!item.draft);
    const heading = preview ? 'previewTitle' : preparing ? 'preparingTitle' : committing ? 'writingTitle' : result ? 'resultTitle' : 'title';
    return <Overlay label={t('materials.import')} onClose={hide} className={`lc-import-modal${compact ? ' lc-import-modal--compact' : ''}`} layerClassName={`lc-import-layer${open ? '' : ' lc-import-layer--closing'}`} panelRef={panelRef}>
        <header className="lc-import-header">
            <h2>{compact ? t('materials.import') : phase === 'source' && source === 'youtube' ? t('materials.importDialog.linkTitle') : t(`materials.importDialog.${heading}`)}</h2>
            <button className="ui-button ui-button--icon lc-import-close" aria-label={t(committing ? 'materials.importDialog.minimize' : 'common.close')} onClick={hide}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="lc-import-body">
            {phase === 'source' && (source === 'choose' ? <>
                <div className="lc-import-sources">
                    <button className="lc-import-source lc-import-source--clipboard" disabled={readingClipboard || state.picking} onClick={() => void pasteLink()}><ClipboardPaste aria-hidden="true" size={17} /><strong>{t(readingClipboard ? 'materials.importDialog.readingClipboard' : 'materials.importDialog.pasteLink')}</strong></button>
                    <button className="lc-import-source" disabled={readingClipboard || state.picking} onClick={() => void state.choose()}><FileText aria-hidden="true" size={17} /><strong>{t(state.picking ? 'common.loading' : 'materials.importDialog.file')}</strong></button>
                </div>
            </> : <>
                <button className="ui-button lc-import-back" onClick={() => state.changeSource()}><ArrowLeft size={16} aria-hidden="true" />{t('common.back')}</button>
                {source === 'youtube' ? <YouTubeImport key={linkDraft?.id ?? 'manual'} initialUrl={linkDraft?.url} autoSearch={linkDraft?.autoSearch} initialError={linkDraft?.error} active={open} /> : <div className="lc-import-drop"><Upload size={32} aria-hidden="true" /><h3>{t('materials.drop')}</h3><p>{t('materials.srtOnly')}</p><button className="ui-button lc-import-primary" disabled={state.picking} onClick={() => void state.choose()}>{t(state.picking ? 'common.loading' : 'materials.choose')}</button><small>{t('materials.importDialog.fileLimit')}</small></div>}
            </>)}
            {state.pickerError && <p className="lc-import-error" role="alert">{t('materials.importDialog.pickerFailed')}</p>}
            {(preparing || preview && selected) && <ImportPaper item={preparing ? active : selected} loading={preparing} />}
            {(preview || result || committing) && <>
                <p className="lc-import-summary" role="status">{committing ? t(state.stopping ? 'materials.stopping' : 'materials.processing', { done: processed, total: state.items.length }) : result ? t('materials.finished', { count: state.items.filter(item => item.stage === 'created').length }) : t('materials.importDialog.readyCount', { count: valid.length, total: state.items.length })}</p>
                {(state.items.length > 1 || !preview || !selected) && <ul className="lc-import-items">{state.items.map(item => <li key={item.id}>
                    {preview && item.draft ? <button className="lc-import-item-select" aria-pressed={selected?.id === item.id} onClick={() => state.select(item.id)}><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span><Check size={18} aria-hidden="true" /></button> : <div className="lc-import-item-status"><FileText size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small></span>{item.stage === 'created' && <Check size={18} aria-hidden="true" />}</div>}
                    {item.error && item.stage === 'failed' && <p className="lc-import-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
                    {item.englishFallback !== undefined && <button className="ui-button" onClick={() => void state.useEnglish(item.id)}>{t('materials.englishFallback')}</button>}
                    {item.result?.outcome === 'duplicate' && <button className="ui-button" onClick={() => { state.hide(); navigate(item.result!.readable ? `/files/${item.result!.file_id}` : `/legacy?fileId=${item.result!.file_id}`); }}>{t('materials.openExisting')}</button>}
                </li>)}</ul>}
                {retryable && <button className="ui-button" onClick={() => void state.retry()} disabled={running}>{t('materials.retryFailed')}</button>}
            </>}
        </div>
        {(preparing || preview || committing || result) && <footer className="lc-import-footer">
            {preparing ? <><p>{t('materials.importDialog.confirmHint')}</p><button className="ui-button" onClick={state.cancel}>{t('common.cancel')}</button></> : committing ? <><p>{t('materials.importDialog.backgroundHint')}</p><button className="ui-button" disabled={state.stopping} onClick={state.cancel}>{t('materials.cancelRemaining')}</button></> : preview ? <><button className="ui-button" onClick={() => state.changeSource()}>{t('materials.importDialog.changeSource')}</button><button className="ui-button lc-import-primary" disabled={!valid.length} onClick={() => void state.confirm()}>{t('materials.importDialog.confirm', { count: valid.length })}</button></> : <><button className="ui-button" onClick={() => state.changeSource()}>{t('materials.importDialog.importMore')}</button><button className="ui-button lc-import-primary" onClick={hide}>{t('common.close')}</button></>}
        </footer>}
    </Overlay>;
}
