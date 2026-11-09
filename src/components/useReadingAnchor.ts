import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

type Anchor = { node: HTMLElement; offset: number; sentence?: string; word?: string; kind: string };

/** Preserve the visible original through typography reflow and through every
 * frame of a translation disclosure. Explicit browsing always releases the lock. */
export default function useReadingAnchor(scroll: RefObject<HTMLDivElement | null>) {
    const refresh = useRef<() => void>(() => {});
    const preserve = useRef<() => void>(() => {});
    const capturePosition = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        const viewport = scroll.current;
        const paper = viewport?.querySelector<HTMLElement>('.reading-paper');
        if (!viewport || !paper) return;
        let anchor: Anchor | null = null;
        let geometry = '', frame = 0;
        let transaction: { committed: boolean; start: number; height: number; quiet: number } | null = null;
        const signature = () => {
            const text = paper.querySelector('.reading-original');
            const style = text && getComputedStyle(text);
            return [viewport.clientWidth, viewport.clientHeight, paper.offsetWidth, style?.fontSize, style?.lineHeight].join(':');
        };
        const capture = (preferred?: HTMLElement) => {
            const outer = viewport.getBoundingClientRect();
            const controls = viewport.parentElement?.querySelector<HTMLElement>('.reading-playback:not([data-closing])');
            const bottom = controls ? Math.min(outer.bottom, controls.getBoundingClientRect().top - 20) : outer.bottom;
            const visible = (node: HTMLElement) => { const r = node.getBoundingClientRect(); return r.bottom > outer.top && r.top < bottom; };
            const firstWord = (within: Element) => [...within.querySelectorAll<HTMLElement>('.reading-word')].find(visible);
            const selected = paper.querySelector<HTMLElement>('.reading-word[aria-pressed="true"]');
            const current = paper.querySelector<HTMLElement>('[data-current="true"] .reading-original');
            const currentAnchor = current && visible(current) ? current.getBoundingClientRect().top >= outer.top ? current : firstWord(current) : null;
            const node = preferred && visible(preferred) ? preferred : selected && visible(selected) ? selected : currentAnchor
                ?? firstWord(paper) ?? [...paper.querySelectorAll<HTMLElement>('.reading-original,.reading-translation-disclosure[data-open] .reading-translation')].find(visible);
            anchor = node ? { node, offset: node.getBoundingClientRect().top - outer.top, sentence: node.closest<HTMLElement>('[data-sentence]')?.dataset.sentence,
                word: node.dataset.wordIndex, kind: node.classList.contains('reading-word') ? '.reading-word' : node.classList.contains('reading-original') ? '.reading-original' : '.reading-translation' } : null;
            geometry = signature();
        };
        const compensate = () => {
            if (!anchor) return;
            if (!anchor.node.isConnected && anchor.sentence !== undefined) {
                const replacement = paper.querySelector<HTMLElement>(`[data-sentence="${anchor.sentence}"] ${anchor.kind}${anchor.word === undefined ? '' : `[data-word-index="${anchor.word}"]`}`);
                if (replacement) anchor.node = replacement;
            }
            if (!anchor.node.isConnected) { capture(); return; }
            // Native anchoring may have already helped. Apply only the remainder.
            const delta = anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
            if (Math.abs(delta) > .5) viewport.scrollTop = Math.round(viewport.scrollTop + delta);
        };
        const finish = (interrupted = false) => {
            if (!transaction) return;
            transaction = null; cancelAnimationFrame(frame); frame = 0;
            delete viewport.dataset.readingAnchoring;
            capture();
            viewport.dispatchEvent(new CustomEvent('reading-anchor-end', { detail: { interrupted } }));
        };
        const tick = () => {
            frame = 0;
            const state = transaction;
            if (!state || !viewport.isConnected) return;
            compensate();
            const height = paper.getBoundingClientRect().height;
            state.quiet = Math.abs(height - state.height) < .01 ? state.quiet + 1 : 0;
            state.height = height;
            // Wait for the React commit and for the real disclosure height to
            // settle, including reduced motion and reversals partway through.
            const elapsed = performance.now() - state.start;
            if ((state.committed && state.quiet >= 3 && elapsed > 64) || elapsed > 1200) { finish(); return; }
            frame = requestAnimationFrame(tick);
        };
        preserve.current = () => {
            if (!viewport.isConnected) return;
            cancelAnimationFrame(frame);
            if (!transaction) capture();
            transaction = { committed: false, start: performance.now(), height: paper.getBoundingClientRect().height, quiet: 0 };
            viewport.dataset.readingAnchoring = 'true';
            // Cancel an in-flight follow before translation changes the DOM.
            viewport.dispatchEvent(new Event('reading-anchor-start'));
            frame = requestAnimationFrame(tick);
        };
        const restore = () => {
            if (transaction) { compensate(); return; }
            if (signature() !== geometry) compensate();
            capture();
        };
        refresh.current = () => { if (transaction) transaction.committed = true; restore(); };
        capturePosition.current = capture;
        capture();
        const observer = new ResizeObserver(restore);
        observer.observe(viewport); observer.observe(paper);
        // Compensation scrolls must not replace the pre-disclosure snapshot.
        const onScroll = () => { if (!transaction && signature() === geometry) capture(); };
        const pointer = (event: PointerEvent) => {
            finish(true);
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.reading-word') : null;
            capture(target ?? undefined);
        };
        const manual = () => { finish(true); capture(); };
        const keys = (event: KeyboardEvent) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) manual(); };
        const tab = (event: KeyboardEvent) => { if (event.key === 'Tab') finish(true); };
        viewport.addEventListener('scroll', onScroll, { passive: true });
        viewport.addEventListener('pointerdown', pointer, true);
        viewport.addEventListener('wheel', manual, { passive: true });
        viewport.addEventListener('touchmove', manual, { passive: true });
        viewport.addEventListener('keydown', keys);
        document.addEventListener('keydown', tab);
        return () => {
            preserve.current = () => {}; refresh.current = () => {}; capturePosition.current = () => {};
            transaction = null; cancelAnimationFrame(frame); delete viewport.dataset.readingAnchoring;
            observer.disconnect(); viewport.removeEventListener('scroll', onScroll); viewport.removeEventListener('pointerdown', pointer, true);
            viewport.removeEventListener('wheel', manual); viewport.removeEventListener('touchmove', manual); viewport.removeEventListener('keydown', keys); document.removeEventListener('keydown', tab);
        };
    }, [scroll]);
    useLayoutEffect(() => { refresh.current(); });
    const preservePosition = useCallback(() => preserve.current(), []);
    const rememberViewport = useCallback(() => capturePosition.current(), []);
    return { preservePosition, rememberViewport };
}
