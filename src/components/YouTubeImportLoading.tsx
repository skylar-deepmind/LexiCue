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
// Each mark keeps its identity as it moves from the caption to the waveform
// and then onto a line in the preview paper.
const marks = [
    { cue: [-30, 7], wave: [-24, .32], line: [-51, 66] },
    { cue: [-15, 7], wave: [-16, .62], line: [-30, 66] },
    { cue: [0, 7], wave: [-8, .94], line: [-8, 66] },
    { cue: [15, 7], wave: [0, .71], line: [-51, 82] },
    { cue: [30, 7], wave: [8, 1.12], line: [-30, 82] },
    { cue: [-8, 18], wave: [16, .82], line: [-51, 98] },
    { cue: [8, 18], wave: [24, .46], line: [-30, 98] },
].map(({ cue, wave, line }, index) => ({
    '--cue-x': `${cue[0]}px`, '--cue-y': `${cue[1]}px`,
    '--wave-x': `${wave[0]}px`, '--wave-scale': wave[1],
    '--line-x': `${line[0]}px`, '--line-y': `${line[1]}px`,
    '--beat-delay': `${-index * 95}ms`,
}) as CSSProperties);

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
                    <Link2 className="lc-youtube-link-symbol" size={32} strokeWidth={1.45} />
                    <Image className="lc-youtube-image-symbol" size={32} strokeWidth={1.45} />
                    <i className="lc-youtube-scan" />
                    <span className="lc-youtube-loading-track" data-indeterminate={progress === undefined}>
                        <i style={{ '--lc-audio-progress': progress ?? 0 } as CSSProperties} />
                        <i className="lc-youtube-pending" />
                    </span>
                </span>
                <span className="lc-youtube-marks">
                    {marks.map((style, index) => <i key={index} style={style}><b /></i>)}
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
