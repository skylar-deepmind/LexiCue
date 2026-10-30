import { useLayoutEffect, useRef, type RefObject } from 'react';

/** One grid owns both columns; the body Portal follows its empty second slot.
 * Measurements include paper padding and the sentence-number gutter. No React
 * state changes or animated widths are involved in resizing. */
export default function useReadingLayout(scroll: RefObject<HTMLDivElement | null>) {
    const layout = useRef<HTMLDivElement>(null);
    const slot = useRef<HTMLDivElement>(null);
    const updateRef = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        const viewport = scroll.current, grid = layout.current;
        if (!viewport || !grid) return;
        const update = () => {
            const paper = grid.querySelector<HTMLElement>('.reading-paper');
            const text = grid.querySelector<HTMLElement>('.reading-original');
            const sentence = grid.querySelector<HTMLElement>('.reading-sentence');
            if (!paper || !text || !sentence) return;
            const padding = getComputedStyle(viewport), paperStyle = getComputedStyle(paper);
            const available = viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
            const font = parseFloat(getComputedStyle(text).fontSize);
            const gutter = text.getBoundingClientRect().left - sentence.getBoundingClientRect().left;
            const inset = parseFloat(paperStyle.paddingLeft) + parseFloat(paperStyle.paddingRight) + gutter;
            // Georgia's average English glyph is narrower than its 0 (ch).
            // 32em is calibrated on complete prose lines, not sentence endings.
            const paperMax = font * 32 + inset, paperMin = font * 20 + inset;
            const gap = Math.max(24, Math.min(40, available * .025));
            const columns = grid.dataset.queryOpen === 'true' && available >= paperMin + 320 + gap;
            const width = Math.min(available, paperMax + (columns ? 480 + gap : 0));
            const panel = columns ? Math.min(480, 320 + Math.max(0, width - paperMin - 320 - gap) * .4) : 0;
            grid.dataset.layout = columns ? 'columns' : 'single';
            grid.style.width = `${Math.max(0, width)}px`;
            grid.style.setProperty('--reading-gap', `${gap}px`);
            grid.style.setProperty('--reading-panel-width', `${panel}px`);
            // A slot can change position without changing its own dimensions.
            slot.current?.dispatchEvent(new Event('reading-layout'));
        };
        updateRef.current = update;
        update();
        const observer = new ResizeObserver(update);
        observer.observe(viewport);
        const paper = grid.querySelector('.reading-paper');
        if (paper) observer.observe(paper);
        window.addEventListener('resize', update);
        return () => { observer.disconnect(); window.removeEventListener('resize', update); };
    }, [scroll]);
    // Run after React applies font preferences, translation and query changes.
    useLayoutEffect(() => { updateRef.current(); });
    return { layout, slot };
}
