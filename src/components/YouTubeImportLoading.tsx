import { Image, Link2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
const waveHeights = [10, 19, 31, 23, 36, 26, 15];

export default function YouTubeImportLoading({ item, disabled }: { item: ImportItem; disabled: boolean }) {
    const { t } = useTranslation();
    const grip = useRef<HTMLButtonElement>(null);
    const download = item.youtubeProgress;
    const [showParsing, setShowParsing] = useState(false);
    useEffect(() => {
        if (item.stage !== 'parsing' || !download) return;
        // Fast subtitle parsing can finish between two video frames.
        const timer = window.setTimeout(() => setShowParsing(true), 120);
        return () => window.clearTimeout(timer);
    }, [item.stage, download]);
    const stage = item.stage === 'translating' ? 'translating'
        : item.stage === 'parsing' && (showParsing || !download) ? 'parsing'
        : download?.phase ?? 'metadata';
    const label = t(`materials.importDialog.${status[stage]}`);
    const translating = stage === 'translating';
    const translation = translating ? item.translationProgress : undefined;
    const progress = download?.phase === 'audio' ? download.fraction : undefined;
    const lines = translation?.total ? Math.min(1, translation.done / translation.total) : 0;
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
                <span className="lc-youtube-loading-cover">
                    {stage === 'metadata' && <><Link2 size={32} strokeWidth={1.45} />
                        <i className="lc-youtube-scan" /></>}
                    {stage === 'captions' && <span className="lc-youtube-cues"><i /><i /></span>}
                    {stage === 'audio' ? <span className="lc-youtube-wave">
                        {waveHeights.map((height, index) => <i key={index}
                            style={{ height, animationDelay: `${-index * 95}ms` }} />)}
                    </span> : stage !== 'metadata' && stage !== 'captions' && <Image size={32} strokeWidth={1.45} />}
                    {stage === 'audio' && <span className="lc-youtube-loading-track" data-indeterminate={progress === undefined}>
                        <i style={{ '--lc-audio-progress': progress ?? 0 } as CSSProperties} />
                    </span>}
                </span>
                <span className="lc-youtube-loading-lines">
                    {[0, 1, 2].map(index => <span key={index} className="lc-youtube-loading-line"
                        style={{ '--lc-line-progress': Math.max(0, Math.min(1, lines * 3 - index)) } as CSSProperties}>
                        <i /><i />
                    </span>)}
                </span>
            </span>
        </button>
        <p className="sr-only" role="status">{label}</p>
        {translation?.total ? <span className="sr-only" role="progressbar" aria-label={label}
            aria-valuemin={0} aria-valuemax={translation.total} aria-valuenow={translation.done} />
            : stage === 'audio' && <span className="sr-only" role="progressbar" aria-label={label}
                aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)} />}
    </div>;
}
