import { useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportItem } from '../stores/importStore';
import useTrashDrag from './useTrashDrag';
import './youtube-import-loading.css';

const status = {
    metadata: 'youtubeLoadingVideo',
    captions: 'youtubeLoadingCaptions',
    media: 'youtubeLoadingMedia',
    audio: 'youtubeLoadingMedia',
    parsing: 'youtubeLoadingText',
    translating: 'youtubeLoadingTranslation',
} as const;

// The line reserves space for each step. Only reported bytes and completed
// sentences can advance it within the audio and translation steps.
const step = { metadata: 0, captions: .18, media: .37, audio: .49, parsing: .75, translating: .79 } as const;

export default function YouTubeImportLoading({ item, disabled }: { item: ImportItem; disabled: boolean }) {
    const { t } = useTranslation();
    const grip = useRef<HTMLButtonElement>(null);
    const download = item.youtubeProgress;
    const stage = item.stage === 'parsing' || item.stage === 'translating'
        ? item.stage : download?.phase ?? 'metadata';
    const label = t(`materials.importDialog.${status[stage]}`);
    const translation = stage === 'translating' ? item.translationProgress : undefined;
    const audio = stage === 'audio' && download?.phase === 'audio' ? download.fraction : undefined;
    const translated = translation?.total ? Math.min(1, translation.done / translation.total) : 0;
    const fill = step[stage] + (stage === 'audio' ? (step.parsing - step.audio) * (audio ?? 0)
        : (1 - step.translating) * translated);
    const pending = stage === 'translating' ? !translation?.done : audio === undefined;

    const openTrashTarget = useTrashDrag(grip, {
        id: 'import-preparation',
        label,
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

    return <div className="lc-youtube-loading" data-stage={stage}>
        <button ref={grip} type="button" className="lc-youtube-loading-grip" disabled={disabled}
            aria-label={t('reader.discardImport')} onClick={openTrashTarget}>
            <span className="lc-youtube-loading-card" aria-hidden="true">
                <span className="lc-youtube-loading-track" data-pending={pending}
                    style={{ '--youtube-fill': fill } as CSSProperties}><i /></span>
            </span>
        </button>
        <p className="sr-only" role="status">{label}</p>
        {translation?.total ? <span className="sr-only" role="progressbar" aria-label={label}
            aria-valuemin={0} aria-valuemax={translation.total} aria-valuenow={translation.done} />
            : stage === 'audio' && <span className="sr-only" role="progressbar" aria-label={label}
                aria-valuenow={audio === undefined ? undefined : Math.round(audio * 100)} />}
    </div>;
}
