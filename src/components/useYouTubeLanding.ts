import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useImportStore, type ImportPhase } from '../stores/importStore';

type LoadingFrame = { box: DOMRect; copy: HTMLElement; stage: string; width: number; height: number };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const animatedArt = '.lc-youtube-loading-cover > svg, .lc-youtube-scan, .lc-youtube-loading-track, '
    + '.lc-youtube-loading-track > i, .lc-youtube-marks > i, .lc-youtube-marks b, .lc-youtube-loading-line > i';

/** Use the size and position the loading card actually occupied as the first
 * frame of the real preview. The preview is mounted as soon as its draft is ready. */
export function useYouTubeLanding(open: boolean, phase: ImportPhase, panelRef: RefObject<HTMLDivElement | null>) {
    const frame = useRef<LoadingFrame | null>(null);

    useLayoutEffect(() => useImportStore.subscribe((next, previous) => {
        if (next.phase === previous.phase) return;
        frame.current = null;
        if (!next.open || previous.phase !== 'preparing' || next.phase !== 'preview'
            || next.items.length !== 1 || next.items[0].kind !== 'youtube' || !next.items[0].draft
            || next.items[0].id !== previous.items[0]?.id || reducedMotion()) return;

        const card = panelRef.current?.querySelector<HTMLElement>('.lc-youtube-loading-card');
        const stage = card?.closest<HTMLElement>('.lc-youtube-loading')?.dataset.stage;
        if (!card || !stage || card.closest('[data-trash-lifted]') || !card.animate) return;
        const box = card.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const copy = card.cloneNode(true) as HTMLElement;
        const parts = copy.querySelectorAll<HTMLElement | SVGElement>(animatedArt);
        card.querySelectorAll<HTMLElement | SVGElement>(animatedArt).forEach((node, index) => {
            const { transform, opacity } = getComputedStyle(node);
            Object.assign(parts[index].style, { transform, opacity });
        });
        copy.style.opacity = getComputedStyle(card).opacity;
        frame.current = { box, copy, stage, width: card.offsetWidth, height: card.offsetHeight };
    }), [panelRef]);

    useLayoutEffect(() => {
        if (!open || phase !== 'preview') return;
        const source = frame.current;
        frame.current = null;
        const panel = panelRef.current;
        const layer = panel?.parentElement;
        const card = panel?.querySelector<HTMLElement>('.import-material-card');
        if (!source || !layer || !card?.animate || reducedMotion() || document.hidden) return;

        const target = card.getBoundingClientRect();
        const viewport = layer.getBoundingClientRect();
        if (!target.width || !target.height) return;
        const { box, copy, stage, width, height } = source;
        if (!(width > 0 && height > 0)) return;

        const pose = (x: number, y: number, sx: number, sy: number) =>
            `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;

        const ghost = document.createElement('div');
        ghost.className = 'lc-youtube-loading lc-youtube-landing-copy';
        ghost.dataset.stage = stage;
        ghost.inert = true;
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {
            left: `${box.left - viewport.left}px`, top: `${box.top - viewport.top}px`,
            inlineSize: `${width}px`, blockSize: `${height}px`,
        });
        ghost.append(copy);
        layer.append(ghost);

        const dx = target.left - box.left, dy = target.top - box.top;
        const duration = 320;
        const easing = 'cubic-bezier(.2,.72,.23,1)';
        const moving = [
            card.animate([
                { transform: pose(-dx, -dy, box.width / target.width, box.height / target.height), transformOrigin: '0 0' },
                { transform: 'none', transformOrigin: '0 0' },
            ], { duration, easing }),
            ghost.animate([
                { transform: pose(0, 0, box.width / width, box.height / height) },
                { transform: pose(dx, dy, target.width / width, target.height / height) },
            ], { duration, easing }),
            ghost.animate([{ opacity: 1 }, { opacity: 1, offset: .16 }, { opacity: 0 }],
                { duration, fill: 'forwards', easing: 'ease-out' }),
        ];
        const finish = () => {
            clearTimeout(timer);
            moving.forEach(animation => animation.cancel());
            ghost.remove();
            window.removeEventListener('resize', finish);
            document.removeEventListener('visibilitychange', finish);
        };
        const timer = setTimeout(finish, duration + 100);
        window.addEventListener('resize', finish, { once: true });
        document.addEventListener('visibilitychange', finish, { once: true });
        void Promise.allSettled(moving.map(animation => animation.finished)).then(finish);
        return finish;
    }, [open, phase, panelRef]);
}
