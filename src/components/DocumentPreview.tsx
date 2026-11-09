import { ActivityTrack } from './LoadingFeedback';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportItem } from '../stores/importStore';
import { documentLocationLabel } from '../lib/documentTypes';

const CHUNK_SIZE = 30;
/** Reveal the complete preview by scrolling, without a second navigation flow. */
export default function DocumentPreview({item}: {item: ImportItem}) {
    const {t} = useTranslation();
    const draft = item.draft!;
    const document = draft.document;
    const full = item.extraction?.document;
    const busy = useImportStore(state => state.selectionBusy === item.id);
    const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
    const [start, setStart] = useState(1);
    const [end, setEnd] = useState(full?.sections.length ?? 1);
    const body = useRef<HTMLDivElement>(null);
    const pendingAnchor = useRef<string | null>(null);
    const entries = useMemo(() => document?.blocks.map(block => ({
        id: block.id, text: block.text, code: block.kind === 'code', heading: block.kind === 'heading',
        label: [document.sections.find(section => section.id === block.section_id)?.title, documentLocationLabel(block.locations[0])].filter(Boolean).join(' · '),
        // Keep source text intact and add only translations absent from it.
        zh: block.segment_indices.map(index => draft.segments[index]?.zh_text?.trim())
            .filter((text): text is string => !!text && !block.text.includes(text)).join(' '),
    })) ?? draft.segments.map(segment => ({id: String(segment.index), text: segment.en_text, code: false, heading: false, label: '', zh: segment.zh_text})), [document, draft.segments]);
    useEffect(() => {
        setVisibleCount(CHUNK_SIZE);
        pendingAnchor.current = null;
        if (body.current) body.current.scrollTop = 0;
    }, [item.id, draft.operation_id]);
    useLayoutEffect(() => {
        if (pendingAnchor.current && body.current) {
            const target = body.current.querySelector<HTMLElement>(`[data-block="${CSS.escape(pendingAnchor.current)}"]`);
            if (target) body.current.scrollTop = target.offsetTop - body.current.offsetTop;
            pendingAnchor.current = null;
        }
    });
    useEffect(() => {
        const selection = draft.document?.selection;
        if (selection?.kind === 'pages') {setStart(selection.start); setEnd(selection.end);}
        else if (selection?.kind === 'chapters' && full) {
            setStart(full.sections.findIndex(section => section.id === selection.section_ids[0]) + 1);
            setEnd(full.sections.findIndex(section => section.id === selection.section_ids.at(-1)) + 1);
        } else {setStart(1); setEnd(full?.sections.length ?? 1);}
    }, [draft.operation_id, draft.document?.selection, full]);
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
            {busy && <div className="document-range-progress" role="status"><span className="sr-only">{t('common.loading')}</span><ActivityTrack /></div>}
        </details>}
        {item.error && <p className="lc-import-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
        {document && document.sections.length > 1 && <label className="lc-document-jump">{t('documents.jump')}<select key={`${item.id}:${draft.operation_id}`} defaultValue={document.blocks[0]?.section_id ?? ''} onChange={event => {
            const index = document.blocks.findIndex(block => block.section_id === event.target.value);
            if (index >= 0 && body.current) {
                const target = body.current.querySelector<HTMLElement>(`[data-block="${CSS.escape(document.blocks[index].id)}"]`);
                if (target) body.current.scrollTop = target.offsetTop - body.current.offsetTop;
                else {pendingAnchor.current = document.blocks[index].id; setVisibleCount(value => Math.max(value, index + CHUNK_SIZE));}
            }
        }}>{document.sections.filter(section => document.blocks.some(block => block.section_id === section.id)).map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
        <div className="lc-import-excerpts lc-document-preview" ref={body} tabIndex={0} aria-label={t('materials.importDialog.previewTitle')} onScroll={event => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight < 200) setVisibleCount(value => Math.min(entries.length, value + CHUNK_SIZE));
        }}>
            {entries.slice(0, visibleCount).map(entry => <div key={entry.id} data-block={entry.id}>
                {entry.label && <small className="lc-document-location">{entry.label}</small>}
                {entry.code ? <pre>{entry.text}</pre> : <p lang="en" className={entry.heading ? 'lc-document-heading' : undefined}>{entry.text}</p>}
                {entry.zh && <p lang="zh">{entry.zh}</p>}
            </div>)}
            {visibleCount >= entries.length && <p className="lc-document-end" role="status">{t('documents.end')}</p>}
        </div>
    </>;
}
