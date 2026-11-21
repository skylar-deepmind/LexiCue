import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore } from '../stores/importStore';
import useTrashDrag from './useTrashDrag';

export default function ImportPaper({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const card = useRef<HTMLButtonElement>(null);
    const openTrashTarget = useTrashDrag(card, {
        id: 'import-preparation',
        label: t('materials.importDialog.preparingTitle'),
        disabled,
        discardPreview: true,
        showBinOnLift: true,
        remove: async () => {
            const state = useImportStore.getState();
            if (!state.open || state.phase !== 'preparing') return false;
            state.cancel();
            return true;
        },
    });

    return <div className="lc-import-paper-stage">
        <button ref={card} type="button" className="lc-import-paper-grip" disabled={disabled}
            aria-label={t('reader.discardImport')} onClick={openTrashTarget}>
            <span className="lc-import-paper-character" aria-hidden="true">
                <span className="lc-import-paper-fold" />
                <span className="lc-import-paper-eyes"><i /><i /></span>
                <span className="lc-import-paper-line" />
                <span className="lc-import-paper-line" />
                <span className="lc-import-paper-line" />
            </span>
        </button>
        <p className="lc-import-loading-copy" role="status">{t('materials.importDialog.preparingTitle')}</p>
    </div>;
}
