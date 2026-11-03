import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Size both desktop columns independently of lookup visibility. The paper only
 * translates between its centered and paired positions when lookup toggles. */
export default function useReadingLayout(scroll: RefObject<HTMLDivElement | null>) {
    const layout = useRef<HTMLDivElement>(null);
    const slot = useRef<HTMLDivElement>(null);
    const updateRef = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        const viewport = scroll.current, grid = layout.current;
        if (!viewport || !grid) return;
        let geometry = '', resizeFrame = 0;
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
            // Fixed prose measure, recalculated after the approved font loads.
            const paperMax = font * 32 + inset, paperMin = font * 20 + inset;
            const gap = Math.max(24, Math.min(40, available * .025));
            const desktop = window.innerWidth >= 768;
            const width = Math.min(available, paperMax + (desktop ? 480 + gap : 0));
            const panel = desktop ? Math.min(480, 320 + Math.max(0, width - paperMin - 320 - gap) * .4) : 0;
            const nextGeometry = [available, font, inset, desktop].join(':');
            if (nextGeometry !== geometry) {
                // Window/font changes may reflow, but must not also animate an
                // obsolete centering offset. Lookup toggles keep this geometry.
                geometry = nextGeometry;
                grid.dataset.resizing = 'true';
                cancelAnimationFrame(resizeFrame);
                resizeFrame = requestAnimationFrame(() => { delete grid.dataset.resizing; });
            }
            grid.dataset.desktop = String(desktop);
            grid.dataset.layout = desktop && grid.dataset.queryOpen === 'true' ? 'columns' : 'single';
            if (grid.dataset.queryOpen !== 'true') delete grid.dataset.queryClosing;
            grid.style.width = `${Math.max(0, width)}px`;
            grid.style.setProperty('--reading-gap', `${gap}px`);
            grid.style.setProperty('--reading-panel-width', `${panel}px`);
            grid.style.setProperty('--reading-paper-shift', `${desktop ? (panel + gap) / 2 : 0}px`);
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
        void document.fonts.ready.then(update);
        return () => { cancelAnimationFrame(resizeFrame); observer.disconnect(); window.removeEventListener('resize', update); };
    }, [scroll]);
    // Run after React applies font preferences, translation and query changes.
    useLayoutEffect(() => { updateRef.current(); });
    return { layout, slot };
}
