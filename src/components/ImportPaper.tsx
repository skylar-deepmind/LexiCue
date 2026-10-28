import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportItem } from '../stores/importStore';

/** One paper surface follows the real preparation state; motion never gates work. */
export default function ImportPaper({ item, loading }: { item?: ImportItem; loading: boolean }) {
    const { t } = useTranslation();
    const paper = useRef<HTMLDivElement>(null);
    const smallRect = useRef<DOMRect | null>(null);
    useLayoutEffect(() => {
        const node = paper.current;
        if (!node) return;
        if (loading) { smallRect.current = node.getBoundingClientRect(); return; }
        const from = smallRect.current;
        smallRect.current = null;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const to = node.getBoundingClientRect();
        const x = from ? from.left + from.width / 2 - (to.left + to.width / 2) : 0;
        const y = from ? from.top + from.height / 2 - (to.top + to.height / 2) : 12;
        const animation = node.animate([
            { transform: `translate(${x}px, ${y}px) scale(${from ? from.width / to.width : .98}, ${from ? from.height / to.height : .98})`, opacity: from ? 1 : .5 },
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ], { duration: 560, easing: 'cubic-bezier(.22,.8,.28,1)' });
        return () => animation.cancel();
    }, [loading, item?.id]);
    return <div className={`lc-import-paper-stage${loading ? ' is-loading' : ''}`}>
        <div ref={paper} className={`lc-import-paper${loading ? ' lc-import-paper--small' : ''}`}>
            {loading ? <div className="lc-import-paper-character" aria-hidden="true">
                <div className="lc-import-paper-fold" /><div className="lc-import-paper-eyes"><i /><i /></div>
                <span /><span /><span />
            </div> : item?.draft && <article className="lc-import-preview" aria-label={t('materials.importDialog.preview')}>
                <div className="lc-import-preview-meta"><span>{t('materials.importDialog.excerpt')}</span><span>{t('materials.importDialog.stats', { segments: item.draft.segments.length, words: item.draft.wordCount })}</span></div>
                <h3>{item.title ?? item.name}</h3>
                <p className="lc-import-preview-source">{item.kind === 'youtube' ? `YouTube · ${item.url}` : t('materials.importDialog.localFile', { type: item.name.split('.').at(-1)?.toUpperCase() })}</p>
                <div className="lc-import-excerpts">{item.draft.segments.slice(0, 3).map(segment => <div key={segment.index}>
                    <p lang="en">{segment.en_text}</p>{segment.zh_text && <p lang="zh">{segment.zh_text}</p>}
                </div>)}</div>
            </article>}
        </div>
        {loading && <div className="lc-import-loading-copy" role="status"><strong>{t(`materials.stages.${item?.stage ?? 'queued'}`)}</strong><p>{item?.title ?? item?.name}</p><small>{item?.stage === 'translating' && item.translationProgress ? t('materials.importDialog.translationProgress', { ...item.translationProgress }) : t('materials.importDialog.preparingHint')}</small></div>}
    </div>;
}
