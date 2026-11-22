import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore } from '../stores/importStore';
import useTrashDrag from './useTrashDrag';
import type { MaterialDropPoint } from './useMaterialDrop';

export default function ImportPaper({ disabled, dropOrigin }: { disabled: boolean; dropOrigin: MaterialDropPoint | null }) {
    const { t } = useTranslation();
    const card = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => {
        const paper = card.current;
        if (!dropOrigin || !paper?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const { left, top, width, height } = paper.getBoundingClientRect();
        const x = dropOrigin.x - (left + width / 2);
        const y = dropOrigin.y - (top + height / 2);
        const flight = paper.animate([
            { transform: `translate(${x}px, ${y}px) scale(.58)` },
            { transform: 'none' },
        ], { duration: 240, easing: 'cubic-bezier(.2,.76,.24,1)' });
        return () => flight.cancel();
    }, [dropOrigin]);
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
