import { useTranslation } from 'react-i18next';
import DocumentPreview from './DocumentPreview';
import { useImportStore, type ImportItem } from '../stores/importStore';

/** One paper surface follows the real preparation state; motion never gates work. */
export default function ImportPaper({ item, loading }: { item?: ImportItem; loading: boolean }) {
    const { t } = useTranslation();
    return <div className={`lc-import-paper-stage${loading ? ' is-loading' : ''}`}>
        <div className={`lc-import-paper${loading ? ' lc-import-paper--small' : ''}`}>
            {loading ? <div className="lc-import-paper-character" aria-hidden="true">
                <div className="lc-import-paper-fold" /><div className="lc-import-paper-eyes"><i /><i /></div>
                <span /><span /><span />
            </div> : item?.draft && <article className="lc-import-preview" aria-label={t('materials.importDialog.preview')}>
                <div className="lc-import-preview-meta"><span>{t('documents.fullPreview')}</span><span>{t('materials.importDialog.stats', { segments: item.draft.segments.length, words: item.draft.wordCount })}</span></div>
                {item.draft.document?.origin ? <label className="lc-content-title">{t('materials.importDialog.materialTitle')}<input value={item.draft.name} maxLength={240} onChange={event => useImportStore.getState().renameDraft(item.id, event.target.value)} /></label> : <h3>{item.title ?? item.name}</h3>}
                <p className="lc-import-preview-source">{item.draft.document?.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : item.draft.document?.origin?.kind === 'webpage' ? item.draft.document.origin.final_url : item.kind === 'youtube' ? `YouTube · ${item.url}` : t('materials.importDialog.localFile', { type: item.name.split('.').at(-1)?.toUpperCase() })}</p>
                {item.draft.sourceIssue && <p className="lookup-note" role="status">{t('sourceAudio.sourceUnavailable')}</p>}
                <DocumentPreview item={item} />
            </article>}
        </div>
        {loading && <div className="lc-import-loading-copy" role="status"><strong>{t(item?.kind === 'webpage' && item.stage === 'reading' ? 'materials.importDialog.readingWebpage' : item?.kind === 'clipboard' && item.stage === 'reading' ? 'materials.stages.parsing' : `materials.stages.${item?.stage ?? 'queued'}`)}</strong><p>{item?.title ?? item?.name}</p><small>{item?.stage === 'translating' && item.translationProgress ? t('materials.importDialog.translationProgress', { ...item.translationProgress }) : t('materials.importDialog.preparingHint')}</small></div>}
    </div>;
}
