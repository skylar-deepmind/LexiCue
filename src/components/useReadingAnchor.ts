import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Keep a visible word/first sentence at its viewport offset when typography
 * reflows. Native anchoring may already have compensated: apply only the delta.
 * Ordinary scrolling, pagination and playback moves refresh the snapshot. */
export default function useReadingAnchor(scroll: RefObject<HTMLDivElement | null>) {
    const refresh = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        const viewport = scroll.current;
        const paper = viewport?.querySelector<HTMLElement>('.reading-paper');
        if (!viewport || !paper) return;
        let anchor: { node: HTMLElement; offset: number } | null = null;
        let geometry = '';
        const signature = () => {
            const text = paper.querySelector('.reading-original');
            const style = text && getComputedStyle(text);
            return [viewport.clientWidth, viewport.clientHeight, paper.offsetWidth, style?.fontSize, style?.lineHeight].join(':');
        };
        const capture = (preferred?: HTMLElement) => {
            const outer = viewport.getBoundingClientRect();
            const visible = (node: HTMLElement) => { const r = node.getBoundingClientRect(); return r.bottom > outer.top && r.top < outer.bottom; };
            const selected = paper.querySelector<HTMLElement>('.reading-word[aria-pressed="true"]');
            const node = preferred && visible(preferred) ? preferred : selected && visible(selected) ? selected : Array.from(paper.querySelectorAll<HTMLElement>('[data-sentence]')).find(visible);
            anchor = node ? { node, offset: node.getBoundingClientRect().top - outer.top } : null;
            geometry = signature();
        };
        const restore = () => {
            if (signature() !== geometry && anchor?.node.isConnected) {
                const delta = anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
                if (Math.abs(delta) > .5) viewport.scrollTop += delta;
            }
            capture();
        };
        refresh.current = restore;
        capture();
        const observer = new ResizeObserver(restore);
        observer.observe(viewport); observer.observe(paper);
        // A resize-generated scroll must not overwrite the pre-reflow snapshot.
        const onScroll = () => { if (signature() === geometry) capture(); };
        const pointer = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.reading-word') : null;
            capture(target ?? undefined);
        };
        // Explicit input wins even when delivered in the same frame as resize.
        const manual = () => capture();
        const keys = (event: KeyboardEvent) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) capture(); };
        viewport.addEventListener('scroll', onScroll, { passive: true });
        viewport.addEventListener('pointerdown', pointer, true);
        viewport.addEventListener('wheel', manual, { passive: true });
        viewport.addEventListener('touchmove', manual, { passive: true });
        viewport.addEventListener('keydown', keys);
        return () => { observer.disconnect(); viewport.removeEventListener('scroll', onScroll); viewport.removeEventListener('pointerdown', pointer, true); viewport.removeEventListener('wheel', manual); viewport.removeEventListener('touchmove', manual); viewport.removeEventListener('keydown', keys); };
    }, [scroll]);
    useLayoutEffect(() => { refresh.current(); });
}
