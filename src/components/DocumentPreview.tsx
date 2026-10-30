import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportItem } from '../stores/importStore';
import { documentLocationLabel } from '../lib/documentTypes';

const PAGE_SIZE = 30;
/** Pagination bounds DOM size while keeping every block, including code, reachable. */
export default function DocumentPreview({item}: {item: ImportItem}) {
    const {t} = useTranslation();
    const draft = item.draft!;
    const document = draft.document;
    const full = item.extraction?.document;
    const busy = useImportStore(state => state.selectionBusy === item.id);
    const [page, setPage] = useState(0);
    const [start, setStart] = useState(1);
    const [end, setEnd] = useState(full?.sections.length ?? 1);
    const body = useRef<HTMLDivElement>(null);
    const pendingAnchor = useRef<string | null>(null);
    const entries = useMemo(() => document?.blocks.map(block => ({
        id: block.id, text: block.text, code: block.kind === 'code', heading: block.kind === 'heading',
        label: [document.sections.find(section => section.id === block.section_id)?.title, documentLocationLabel(block.locations[0])].filter(Boolean).join(' · '),
        // Raw document blocks already retain original bilingual text.
        zh: '',
    })) ?? draft.segments.map(segment => ({id: String(segment.index), text: segment.en_text, code: false, heading: false, label: '', zh: segment.zh_text})), [document, draft.segments]);
    useEffect(() => {setPage(0);}, [item.id, draft.operation_id]);
    useEffect(() => {
        if (!body.current) return;
        body.current.scrollTop = 0;
        if (pendingAnchor.current) {
            const target = body.current.querySelector<HTMLElement>(`[data-block="${pendingAnchor.current}"]`);
            if (target) body.current.scrollTop = target.offsetTop - body.current.offsetTop;
            pendingAnchor.current = null;
        }
    }, [page]);
    useEffect(() => {
        const selection = draft.document?.selection;
        if (selection?.kind === 'pages') {setStart(selection.start); setEnd(selection.end);}
        else if (selection?.kind === 'chapters' && full) {
            setStart(full.sections.findIndex(section => section.id === selection.section_ids[0]) + 1);
            setEnd(full.sections.findIndex(section => section.id === selection.section_ids.at(-1)) + 1);
        } else {setStart(1); setEnd(full?.sections.length ?? 1);}
    }, [draft.operation_id, draft.document?.selection, full]);
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const changePage = (value: number) => setPage(Number.isFinite(value) ? Math.max(0, Math.min(pages - 1, Math.trunc(value))) : 0);
    const select = async () => {
        if (!full || start < 1 || end < start || end > full.sections.length) return;
        await useImportStore.getState().selectRange(item.id, full.original_format === 'pdf'
            ? {kind: 'pages', start, end}
            : {kind: 'chapters', section_ids: full.sections.slice(start - 1, end).map(section => section.id)});
    };
    return <>
        {document && <p className="lc-document-stats">{t(document.original_format === 'pdf' ? 'documents.pages' : 'documents.sections', {count: document.sections.length})}{document.selection.kind !== 'all' && <> · {t('documents.selectedRange')}</>}</p>}
        {document?.warnings.length ? <div className="lc-document-notice" role="status"><strong>{t(document.extraction_status === 'partial' ? 'documents.partial' : 'documents.notes')}</strong><ul>{document.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
        {full && ['pdf', 'epub'].includes(full.original_format) && full.sections.length > 1 && <details className="lc-document-range">
            <summary>{t('documents.range')}</summary>
            <p>{t(full.original_format === 'pdf' ? 'documents.pageOrder' : 'documents.chapterOrder')}</p>
            <div className="lc-document-range-fields">
                <label>{t('documents.from')}<select value={start} onChange={event => setStart(Number(event.target.value))} disabled={busy}>{full.sections.map((section, index) => <option key={section.id} value={index + 1}>{full.original_format === 'pdf' ? index + 1 : section.title || index + 1}</option>)}</select></label>
                <label>{t('documents.to')}<select value={end} onChange={event => setEnd(Number(event.target.value))} disabled={busy}>{full.sections.map((section, index) => <option key={section.id} value={index + 1}>{full.original_format === 'pdf' ? index + 1 : section.title || index + 1}</option>)}</select></label>
                <button className="ui-button" onClick={() => void select()} disabled={busy || end < start} aria-busy={busy}>{t('documents.applyRange')}</button>
                <button className="ui-button" onClick={() => void useImportStore.getState().selectRange(item.id, {kind: 'all'})} disabled={busy || document?.selection.kind === 'all'}>{t('documents.all')}</button>
            </div>
            {end < start && <p role="alert">{t('documents.rangeError')}</p>}
            {busy && <p role="status">{t('common.loading')}</p>}
        </details>}
        {item.error && <p className="lc-import-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
        {document && document.sections.length > 1 && <label className="lc-document-jump">{t('documents.jump')}<select value={entries[page * PAGE_SIZE]?.id ? document.blocks[page * PAGE_SIZE]?.section_id : ''} onChange={event => {
            const index = document.blocks.findIndex(block => block.section_id === event.target.value);
            if (index >= 0) {pendingAnchor.current = document.blocks[index].id; changePage(Math.floor(index / PAGE_SIZE)); requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-block="${document.blocks[index].id}"]`)?.scrollIntoView({block: 'start'}));}
        }}>{document.sections.filter(section => document.blocks.some(block => block.section_id === section.id)).map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
        <div className="lc-import-excerpts lc-document-preview" ref={body} tabIndex={0} aria-label={t('documents.fullPreview')}>
            {entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => <div key={entry.id} data-block={entry.id}>
                {entry.label && <small className="lc-document-location">{entry.label}</small>}
                {entry.code ? <pre>{entry.text}</pre> : <p lang="en" className={entry.heading ? 'lc-document-heading' : undefined}>{entry.text}</p>}
                {entry.zh && <p lang="zh">{entry.zh}</p>}
            </div>)}
            {page === pages - 1 && <p className="lc-document-end" role="status">{t('documents.end')}</p>}
        </div>
        <nav className="lc-document-pagination" aria-label={t('documents.previewPages')}>
            <button className="ui-button" disabled={page === 0} onClick={() => changePage(page - 1)}>{t('documents.previous')}</button>
            <label>{t('documents.previewPage')}<input type="number" min={1} max={pages} value={page + 1} onChange={event => changePage(Number(event.target.value) - 1)} /> / {pages}</label>
            <button className="ui-button" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>{t('documents.next')}</button>
            <button className="ui-button" disabled={page === pages - 1} onClick={() => changePage(pages - 1)}>{t('documents.last')}</button>
        </nav>
    </>;
}
