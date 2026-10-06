import { normalizeNavigationPath } from './NavigationItems';
import LearningLanguageSelect from './LearningLanguageSelect';
import VocabularyTabs from './VocabularyTabs';
import { backNavigation } from '../lib/backNavigation';
import { initializeLocalActivity } from '../stores/modelDownloadStore';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import AnalysisPreviewDrawer from './AnalysisPreviewDrawer';
import MobileNav from './MobileNav';
import ToastHost from './ToastHost';
import { useOllamaStore } from '../stores/ollamaStore';
import DictionaryInitNotice from './DictionaryInitNotice';
import { useDictionaryStore } from '../stores/dictionaryStore';
import { useYoutubeStore } from '../stores/youtubeStore';
import { useAiStore } from '../stores/aiStore';
import { useUpdateStore } from '../stores/updateStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { syncCoordinator } from '../lib/syncCoordinator';
import { prepareSpeechVoices } from '../lib/tts';

export default function Layout() {
  const { t } = useTranslation();
  const { pathname: rawPathname } = useLocation();
  const pathname = normalizeNavigationPath(rawPathname);
  const navigate = useNavigate();
  const reading = pathname.startsWith('/files/');
  const vocabulary = pathname === '/words' || pathname === '/phrases';
  useEffect(() => {
    const release = backNavigation.setPage(() => {
      if (pathname.startsWith('/files/')) { navigate('/files'); return true; }
      return false;
    });
    const nativeBack = () => backNavigation.back();
    Object.assign(window, { __lexicueBack: nativeBack });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && backNavigation.hasLayers()) {
        event.preventDefault(); event.stopImmediatePropagation(); backNavigation.dismiss();
      }
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      release(); delete (window as Window & { __lexicueBack?: () => boolean }).__lexicueBack;
      document.removeEventListener('keydown', escape, true);
    };
  }, [pathname, navigate]);
  const initializeOllama = useOllamaStore((state) => state.initialize);
  const initializeDict = useDictionaryStore((state) => state.initialize);
  const initializeYoutube = useYoutubeStore((state) => state.initialize);
  const aiEnabled = useAiStore((state) => state.enabled);
  const checkUpdate = useUpdateStore((state) => state.check);
  const showFeedback = useFeedbackStore((state) => state.show);
  const startupChecked = useRef(false);

  useEffect(() => { void initializeLocalActivity(); }, []);
  useEffect(() => {
    prepareSpeechVoices();
    if (aiEnabled) void initializeOllama();
    void initializeDict();
    void initializeYoutube();
  }, [initializeOllama, initializeDict, initializeYoutube, aiEnabled]);

  useEffect(() => {
    if (startupChecked.current) return;
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

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="@container app-main">
        <DictionaryInitNotice />
        {!reading && !vocabulary && <div className="mobile-language-bar"><span>{t('shell.learningLanguage')}</span><LearningLanguageSelect /></div>}
        {vocabulary && <VocabularyTabs />}
        <div className="app-page">
          <Outlet />
        </div>
        <MobileNav />
      </main>
      <AnalysisPreviewDrawer />
      <ToastHost />
    </div>
  );
}
