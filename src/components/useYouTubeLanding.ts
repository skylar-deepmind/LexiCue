import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useImportStore, type ImportPhase } from '../stores/importStore';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Start the real preview at the last loading-card bounds. */
export function useYouTubeLanding(open: boolean, phase: ImportPhase, panelRef: RefObject<HTMLDivElement | null>) {
    const origin = useRef<DOMRect | null>(null);

    useLayoutEffect(() => useImportStore.subscribe((next, previous) => {
        if (next.phase === previous.phase) return;
        origin.current = null;
        if (!next.open || previous.phase !== 'preparing' || next.phase !== 'preview'
            || next.items.length !== 1 || next.items[0].kind !== 'youtube' || !next.items[0].draft
            || next.items[0].id !== previous.items[0]?.id || reducedMotion()) return;

        const card = panelRef.current?.querySelector<HTMLElement>('.lc-youtube-loading-card');
        if (!card || card.closest('[data-trash-lifted]')) return;
        const box = card.getBoundingClientRect();
        if (box.width && box.height) origin.current = box;
    }), [panelRef]);

    useLayoutEffect(() => {
        if (!open || phase !== 'preview') return;
        const source = origin.current;
        origin.current = null;
        const card = panelRef.current?.querySelector<HTMLElement>('.import-material-card');
        if (!source || !card?.animate || reducedMotion() || document.hidden) return;

        const target = card.getBoundingClientRect();
        if (!target.width || !target.height) return;
        const sx = source.width / target.width, sy = source.height / target.height;
        card.dataset.youtubeLanding = '';
        // Preserve the physical thickness of the loading line at the initial scale.
        card.style.setProperty('--youtube-landing-line', `${3 / sy}px`);
        const duration = 300;
        const movement = card.animate([
            { transform: `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
            { transform: 'none', transformOrigin: '0 0' },
        ], { duration, easing: 'cubic-bezier(.2,.72,.23,1)' });
        const finish = () => {
            clearTimeout(timer);
            delete card.dataset.youtubeLanding;
            card.style.removeProperty('--youtube-landing-line');
            movement.cancel();
            window.removeEventListener('resize', finish);
            document.removeEventListener('visibilitychange', finish);
        };
        const timer = setTimeout(finish, duration + 100);
        window.addEventListener('resize', finish, { once: true });
        document.addEventListener('visibilitychange', finish, { once: true });
        void movement.finished.then(finish, finish);
        return finish;
    }, [open, phase, panelRef]);
}
