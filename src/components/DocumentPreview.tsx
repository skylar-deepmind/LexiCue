import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportItem } from '../stores/importStore';

const CHUNK_SIZE = 30;
/** Reveal the complete preview by scrolling, without a second navigation flow. */
export default function DocumentPreview({item}: {item: ImportItem}) {
    const {t} = useTranslation();
    const draft = item.draft!;
    const document = draft.document;
    const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
    const body = useRef<HTMLDivElement>(null);
    const entries = useMemo(() => document?.blocks.map(block => ({
        id: block.id, text: block.text, code: block.kind === 'code', heading: block.kind === 'heading',
        // Keep source text intact and add only translations absent from it.
        zh: block.segment_indices.map(index => draft.segments[index]?.zh_text?.trim())
            .filter((text): text is string => !!text && !block.text.includes(text)).join(' '),
    })) ?? draft.segments.map(segment => ({id: String(segment.index), text: segment.en_text, code: false, heading: false, zh: segment.zh_text})), [document, draft.segments]);
    useEffect(() => {
        setVisibleCount(CHUNK_SIZE);
        if (body.current) body.current.scrollTop = 0;
    }, [item.id, draft.operation_id]);
    return <>
        {document?.warnings.length ? <div className="lc-document-notice" role="status"><strong>{t(document.extraction_status === 'partial' ? 'documents.partial' : 'documents.notes')}</strong><ul>{document.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
        {item.error && <p className="lc-import-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
        <div className="lc-import-excerpts lc-document-preview" ref={body} tabIndex={0} aria-label={t('materials.importDialog.previewTitle')} onScroll={event => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight < 200) setVisibleCount(value => Math.min(entries.length, value + CHUNK_SIZE));
        }}>
            {entries.slice(0, visibleCount).map(entry => <div key={entry.id} data-block={entry.id}>
                {entry.code ? <pre>{entry.text}</pre> : <p lang="en" className={entry.heading ? 'lc-document-heading' : undefined}>{entry.text}</p>}
                {entry.zh && <p lang="zh">{entry.zh}</p>}
            </div>)}
            {visibleCount >= entries.length && <p className="lc-document-end sr-only" role="status">{t('documents.end')}</p>}
        </div>
    </>;
}
