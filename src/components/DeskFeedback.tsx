import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { useReadingDeskStore } from '../stores/readingDeskStore';
export default function DeskFeedback({ beforeUndo }: { beforeUndo?: () => void }) {
    const { t } = useTranslation();
    const { notice, undo, undoChange, persistenceFailed } = useReadingDeskStore();
    const message = notice ? t(`readingDesk.feedback.${notice.kind}`, {name:notice.name}) : '';
    return <div className="desk-feedback">
        <span role="status" title={message}>{message}</span>
        {undo && <button className="desk-text-button desk-icon-button" title={t('readingDesk.undoLabel')} aria-label={t('readingDesk.undoLabel')} onClick={event => {
            const context=event.currentTarget.closest('.reader-desk-controls, .reading-stage-page');
            beforeUndo?.(); undoChange();
            requestAnimationFrame(() => { if (context?.isConnected) context.querySelector<HTMLButtonElement>('.reader-desk-toolbar > div > button, .desk-archive, .desk-library-dock')?.focus({preventScroll:true}); });
        }}><Undo2 size={20} aria-hidden="true" /></button>}
        {persistenceFailed && <span className="desk-storage-error" role="alert">{t('readingDesk.saveFailed')}</span>}
    </div>;
}
