import { ActivityTrack } from './LoadingFeedback';
import { normalizeNavigationPath } from './NavigationItems';
import { backNavigation } from '../lib/backNavigation';
import { useEffect, useRef, useLayoutEffect } from 'react';
import AppFirstUseGuide from './AppFirstUseGuide';
import WorkspaceHeader from './WorkspaceHeader';
import ImportPanel from './ImportPanel';
import useMaterialDrop from './useMaterialDrop';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ToastHost from './ToastHost';
import { useDictionaryStore } from '../stores/dictionaryStore';
import { useYoutubeStore } from '../stores/youtubeStore';
import { useUpdateStore } from '../stores/updateStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import PageTransition from './PageTransition';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { invalidateCaches } from '../lib/cacheInvalidation';
import { prepareSpeechVoices } from '../lib/tts';
import { useOnboardingStore } from '../stores/onboardingStore';
import { readingReturnPath, retainImportedReading } from '../lib/readingEntry';
import { DESK_KEY } from '../lib/readingDesk';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useMaterialStore } from '../stores/materialStore';
import { useRestoreGuard } from '../stores/restoreGuard';
import Overlay from './Overlay';
import './restore-progress.css';
import '../mobile.css';
export default function Layout() {
    const { t } = useTranslation();
    const restoring = useRestoreGuard(state => state.active);
    const { pathname: rawPathname, state: routeState, search } = useLocation();
    const pathname = normalizeNavigationPath(rawPathname);
    const navigate = useNavigate();
    useEffect(() => {
        const viewport = window.visualViewport;
        const root = document.documentElement;
        let frame = 0;
        let fullHeight = window.innerHeight, fullWidth = window.innerWidth;
        const revealEditor = () => {
            if (root.dataset.keyboardOpen !== 'true') return;
            const editor = document.activeElement;
            if (!(editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)) return;
            // WKWebView focuses before its keyboard finishes resizing. Recheck
            // inner scrollers after layout, without moving the whole document.
            for (let node = editor.parentElement; node && node !== document.body; node = node.parentElement) {
                if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY) || node.scrollHeight <= node.clientHeight) continue;
                const box = node.getBoundingClientRect(), field = editor.getBoundingClientRect();
                const top = Math.max(box.top, viewport?.offsetTop ?? 0) + 8;
                const bottom = Math.min(box.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)) - 8;
                const submit = editor.closest('form')?.querySelector<HTMLButtonElement>('button[type="submit"],button:not([type])')?.getBoundingClientRect();
                const targetBottom = submit && submit.bottom - field.top <= bottom - top ? Math.max(field.bottom, submit.bottom) : field.bottom;
                if (targetBottom > bottom) node.scrollTop += targetBottom - bottom;
                else if (field.top < top) node.scrollTop += field.top - top;
            }
        };
        const update = () => {
            // WKWebView can exclude safe-area insets from visualViewport even
            // with no keyboard. Use the full layout viewport in that case;
            // the shell already applies those insets exactly once.
            if (window.innerWidth !== fullWidth) { fullWidth=window.innerWidth;fullHeight=window.innerHeight; }
            const active=document.activeElement;
            const editing=active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
            if (!editing) fullHeight=Math.max(fullHeight,window.innerHeight);
            // A footer button takes focus before its click. Keep the smaller
            // viewport until the keyboard actually retracts, so the button
            // cannot move away between pointerdown and pointerup.
            const keyboard = (editing || root.dataset.keyboardOpen === 'true') && fullHeight - (viewport?.height ?? window.innerHeight) > 150;
            root.style.setProperty('--visual-height', `${keyboard ? viewport?.height ?? window.innerHeight : window.innerHeight}px`);
            root.style.setProperty('--visual-top', `${keyboard ? viewport?.offsetTop ?? 0 : 0}px`);
            root.dataset.keyboardOpen = String(keyboard);
            // WKWebView may pan its outer document to an autofocus target.
            // Only content scrollers own scrolling in this fixed app shell.
            if (window.innerWidth<768 && window.scrollY) window.scrollTo(0,0);
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(revealEditor); });
        };
        update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        document.addEventListener('focusin', update);
        return () => { cancelAnimationFrame(frame); document.removeEventListener('focusin', update); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); root.style.removeProperty('--visual-height'); root.style.removeProperty('--visual-top'); delete root.dataset.keyboardOpen; };
    }, []);
    useEffect(() => { retainImportedReading(routeState?.importReadingToken); }, [rawPathname, routeState]);
    useMaterialDrop();
    useEffect(() => { document.body.classList.add('lexicue-b'); return () => document.body.classList.remove('lexicue-b'); }, []);
    const panels = useWorkspaceStore(state => state.panels);
    const stageRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage)
            return;
        const update = () => {
            const paper = stage.querySelector<HTMLElement>('.workspace-paper');
            if (paper?.classList.contains('reading-paper')) return;
            const right = paper ? stage.getBoundingClientRect().left + paper.offsetLeft + paper.offsetWidth : 0;
            const shift = window.innerWidth >= 1024 ? Math.max(0, right - (window.innerWidth - 352)) : 0;
            stage.style.setProperty('--workspace-shift', `${shift}px`);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(stage);
        const paper = stage.querySelector('.workspace-paper');
        if (paper)
            observer.observe(paper);
        window.addEventListener('resize', update);
        return () => { observer.disconnect(); window.removeEventListener('resize', update); };
    }, [pathname, panels.length]);
    useEffect(() => {
        const release = backNavigation.setPage(() => {
            if (pathname.startsWith('/files/')) {
                navigate(readingReturnPath(routeState), {state:{restoreLibrary:true}});
                return true;
            }
            return false;
        });
        const nativeBack = () => backNavigation.back();
        Object.assign(window, { __lexicueBack: nativeBack });
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && backNavigation.hasLayers()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                backNavigation.dismiss();
            }
        };
        document.addEventListener('keydown', escape, true);
        return () => {
            release();
            delete (window as Window & {
                __lexicueBack?: () => boolean;
            }).__lexicueBack;
            document.removeEventListener('keydown', escape, true);
        };
    }, [pathname, routeState, navigate]);
    useEffect(() => {
        const refresh = () => { useMaterialStore.getState().changed(); void useMaterialStore.getState().load(); };
        const external = (event: StorageEvent) => { if (event.key === DESK_KEY) useReadingDeskStore.getState().acceptExternal(event.newValue); };
        window.addEventListener('lexicue-sync-applied', refresh);
        window.addEventListener('storage', external);
        return () => { window.removeEventListener('lexicue-sync-applied', refresh); window.removeEventListener('storage', external); };
    }, []);
    const initializeDict = useDictionaryStore((state) => state.initialize);
    const initializeYoutube = useYoutubeStore((state) => state.initialize);
    const checkUpdate = useUpdateStore((state) => state.check);
    const showFeedback = useFeedbackStore((state) => state.show);
    const persistError = useOnboardingStore(state => state.persistError);
    useEffect(() => { if (persistError) showFeedback(t('onboarding.rememberFailed'), 'error'); }, [persistError, showFeedback, t]);
    const startupChecked = useRef(false);
    useEffect(() => {
        prepareSpeechVoices();
        void initializeDict();
        void initializeYoutube();
    }, [initializeDict, initializeYoutube]);
    useEffect(() => {
        if (import.meta.env.VITE_SLICE_PREVIEW === '1' || startupChecked.current)
            return;
        startupChecked.current = true;
        void (async () => {
            await checkUpdate();
            const { status, version } = useUpdateStore.getState();
            if (status === 'available' && version) {
                showFeedback(t('layout.updateAvailable', { version }), 'info', 10000);
            }
        })();
    }, [checkUpdate, showFeedback, t]);
    useEffect(() => {
        if (import.meta.env.VITE_SLICE_PREVIEW === '1' || !isTauri()) return;
        let timer: number | undefined;
        let alive = true;
        const subscription = listen('device-sync-applied', () => {
            if (!alive || timer !== undefined) return;
            timer = window.setTimeout(() => {
                timer = undefined;
                invalidateCaches('files', 'storage');
                window.dispatchEvent(new Event('lexicue-sync-applied'));
            }, 350);
        });
        return () => {
            alive = false;
            window.clearTimeout(timer);
            void subscription.then(stop => stop()).catch(() => {});
        };
    }, []);
    return (<div className="app-layout b-shell" data-context-open={panels.length > 0}>
      <WorkspaceHeader />
      <Sidebar />
      <main className="app-main b-main">
        <div className="app-page workspace-stage" ref={stageRef}>
          <PageTransition pageKey={pathname === '/settings' ? pathname + search : pathname}><Outlet /></PageTransition>
        </div>
        <MobileNav />
      </main>
      <ImportPanel />
      <ToastHost />
      <AppFirstUseGuide />
      {restoring && <Overlay className="restore-progress" label={t('fileStore.restoring')} onClose={() => false}><p role="status">{t('fileStore.restoring')}</p><ActivityTrack /></Overlay>}
    </div>);
}
