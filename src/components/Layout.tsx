import { normalizeNavigationPath } from './NavigationItems';
import { backNavigation } from '../lib/backNavigation';
import { useEffect, useRef, useLayoutEffect } from 'react';
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
export default function Layout() {
    const { t } = useTranslation();
    const restoring = useRestoreGuard(state => state.active);
    const { pathname: rawPathname, state: routeState } = useLocation();
    const pathname = normalizeNavigationPath(rawPathname);
    const navigate = useNavigate();
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
          <PageTransition pageKey={pathname}><Outlet /></PageTransition>
        </div>
        <MobileNav />
      </main>
      <ImportPanel />
      <ToastHost />
      {restoring && <Overlay className="restore-progress" label={t('fileStore.restoring')} onClose={() => false}><p role="status">{t('fileStore.restoring')}</p></Overlay>}
    </div>);
}
