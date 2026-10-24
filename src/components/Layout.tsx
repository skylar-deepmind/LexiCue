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
import { syncCoordinator } from '../lib/syncCoordinator';
import { prepareSpeechVoices } from '../lib/tts';
import { useOnboardingStore } from '../stores/onboardingStore';
export default function Layout() {
    const { t } = useTranslation();
    const { pathname: rawPathname } = useLocation();
    const pathname = normalizeNavigationPath(rawPathname);
    const navigate = useNavigate();
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
                navigate('/files');
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
    }, [pathname, navigate]);
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
        if (startupChecked.current)
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
    // Sync is opportunistic: a failed background attempt remains non-blocking,
    // while the settings page exposes the detailed error on a manual retry.
    useEffect(() => syncCoordinator.start(), []);
    return (<div className="app-layout b-shell" data-context-open={panels.length > 0}>
      <WorkspaceHeader />
      <Sidebar />
      <main className="app-main b-main">
        <div className="app-page workspace-stage" ref={stageRef}>
          <Outlet />
        </div>
        <MobileNav />
      </main>
      <ImportPanel />
      <ToastHost />
    </div>);
}
