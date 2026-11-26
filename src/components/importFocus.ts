import { useImportStore } from '../stores/importStore';

let opener: HTMLElement | null = null;
/** Safari does not reliably focus buttons on pointer activation. */
export function rememberImportFocus(element: HTMLElement) {
    element.focus({ preventScroll: true });
    opener = element;
}

export function openImportFrom(element: HTMLElement) {
    rememberImportFocus(element);
    const state = useImportStore.getState();
    if (state.running) state.show();
    else restoreFocusIfIdle(element, state.choose());
}

export function importLinkFrom(element: HTMLElement) {
    const state = useImportStore.getState();
    if (state.running || state.picking || state.readingLink) return;
    rememberImportFocus(element);
    restoreFocusIfIdle(element, state.fromClipboardLink());
}

function restoreFocusIfIdle(element: HTMLElement, task: Promise<void>) {
    void task.then(() => {
        if (!useImportStore.getState().open && opener === element) {
            opener = null;
            requestAnimationFrame(() => {
                if (element.isConnected && document.activeElement === document.body) element.focus({ preventScroll: true });
            });
        }
    });
}
export function takeImportFocus() { const result = opener; opener = null; return result?.isConnected ? result : null; }
