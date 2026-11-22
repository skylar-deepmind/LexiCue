import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportStore, type ImportItem } from '../stores/importStore';
import useTrashDrag from './useTrashDrag';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (start: number, end: number, fraction: number) => start + (end - start) * fraction;

function paperProgress(items: ImportItem[], finishing: boolean) {
    let download = 0, body = 0, translation = 0;
    const queue = finishing ? items.filter(item => item.stage === 'ready') : items;
    for (const item of queue) {
        if (item.stage === 'reading') download += item.downloadProgress ?? 0;
        if (item.stage === 'parsing' || item.stage === 'translating' || item.stage === 'ready') {
            download += 1;
            body += item.stage === 'parsing' ? item.bodyProgress ?? .18 : 1;
        }
        if (item.stage === 'translating' && item.translationProgress?.total) {
            translation += clamp(item.translationProgress.done / item.translationProgress.total);
        }
        if (item.stage === 'ready' && item.draft?.segments.some(segment => segment.zh_text?.trim())) translation += 1;
    }
    const count = queue.length || 1;
    const active = items.find(item => item.stage === 'reading' || item.stage === 'parsing' || item.stage === 'translating')?.stage;
    return { download: download / count, body: body / count, translation: translation / count, active };
}

const box = (x: number, y: number, width: number, height: number) => ({ left: x - 130, top: y - 45, width, height });
const fragments = [
    { start: [113, 59], end: [163, 82], width: 11, angle: -9 },
    { start: [189, 28], end: [192, 75], width: 13, angle: 13 },
    { start: [250, 89], end: [221, 89], width: 10, angle: -11 },
];
const lines = [
    { start: 47, english: 82, chinese: 36 },
    { start: 41, english: 62, chinese: 58 },
    { start: 47, english: 72, chinese: 44 },
];

export default function ImportPaper({ disabled, finishing, items }: {
    disabled: boolean; finishing: boolean; items: ImportItem[];
}) {
    const { t } = useTranslation();
    const card = useRef<HTMLButtonElement>(null);
    const art = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const node = art.current;
        if (!finishing || !node?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // Settle from the exact position the paper reached when work finished.
        const motion = node.animate([{ transform: getComputedStyle(node).transform }, { transform: 'none' }],
            { duration: 225, easing: 'ease-out', fill: 'forwards' });
        return () => motion.cancel();
    }, [finishing]);
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

    const { download, body, translation, active } = paperProgress(items, finishing);
    const paper = finishing ? 1 : .28 * download + .52 * body + .2 * translation;
    const x = mix(141, 130, paper), y = mix(56, 45, paper);
    const width = mix(104, 126, paper), height = mix(136, 148, paper);
    const cover = finishing ? 1 : .33 * download + .42 * body + .25 * translation;
    return <div className="lc-import-paper-stage" data-stage={finishing ? 'ready' : active ?? 'reading'}>
        <button ref={card} type="button" className="lc-import-paper-grip" disabled={disabled}
            aria-label={t('reader.discardImport')} onClick={openTrashTarget}>
            <span ref={art} className="lc-import-paper-art" aria-hidden="true">
                <span className="lc-import-paper-shadow" style={box(x + 4, y + 8, width, height)} />
                <span className="lc-import-paper-sheet" style={box(x, y, width, height)} />
                <span className="lc-import-paper-cover" style={{
                    ...box(x + 13, y + 13, width - 26, mix(10, 51, cover)),
                    '--cover-ink': `${Math.round(18 + 72 * cover)}%`,
                } as CSSProperties}><i /></span>
                {fragments.map(({start, end, width, angle}, index) => {
                    const arrival = clamp(download * (1.48 - .20 * index));
                    const fade = clamp((arrival - .59) / .41);
                    return <span key={index} className="lc-import-paper-fragment" style={{
                        ...box(mix(start[0], end[0], arrival), mix(start[1], end[1], arrival), width, 9),
                        transform: `rotate(${mix(angle, 0, arrival)}deg)`, opacity: finishing ? 0 : .9 * (1 - fade),
                    }} />;
                })}
                {lines.map((line, index) => {
                    const reveal = clamp(body * 1.4 - index * .18);
                    const translated = clamp(translation * lines.length - index);
                    const top = mix(120, 125, cover) + 17 * index;
                    return <span key={index} className="lc-import-paper-pair" style={{ '--line-delay': `${32 * index}ms` } as CSSProperties}>
                        <i className="lc-import-paper-original" style={{ ...box(x + 15, top, mix(line.start, line.english, reveal), 4), opacity: mix(.25, 1, reveal) }} />
                        <i className="lc-import-paper-translation" style={{ ...box(x + 15, top + 7, mix(line.chinese * .17, line.chinese, translated), 3.4), opacity: translated }} />
                        {active === 'translating' && index === Math.floor(translation * lines.length) &&
                            <i className="lc-import-paper-pending-line" style={box(x + 15, top + 7, line.chinese, 3.4)} />}
                    </span>;
                })}
            </span>
        </button>
        <p className="lc-import-loading-copy" role="status">{t('materials.importDialog.preparingTitle')}</p>
    </div>;
}
