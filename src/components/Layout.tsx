import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ToastHost from './ToastHost';
import { useOllamaStore } from '../stores/ollamaStore';
import { useDictionaryStore } from '../stores/dictionaryStore';
import { useYoutubeStore } from '../stores/youtubeStore';
import { useAiStore } from '../stores/aiStore';

export default function Layout() {
  const { t } = useTranslation();
  const initializeOllama = useOllamaStore((state) => state.initialize);
  const initializeDict = useDictionaryStore((state) => state.initialize);
  const initializeYoutube = useYoutubeStore((state) => state.initialize);
  const dictReady = useDictionaryStore((state) => state.ready);
  const aiEnabled = useAiStore((state) => state.enabled);

  useEffect(() => {
    if (aiEnabled) void initializeOllama();
    void initializeDict();
    void initializeYoutube();
  }, [initializeOllama, initializeDict, initializeYoutube, aiEnabled]);

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden flex flex-col">
        {!dictReady && (
          <div className="pointer-events-none fixed right-4 top-4 z-[90] rounded border px-3 py-1.5 text-xs text-amber-600">
            {t('layout.dictInit')}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>
        <MobileNav />
      </main>
      <ToastHost />
    </div>
  );
}
