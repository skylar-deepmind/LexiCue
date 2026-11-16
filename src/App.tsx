import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import MobileStartup from './components/MobileStartup';
import Layout from './components/Layout';
import FilesPage from './pages/FilesPage';
import { BusyRing } from './components/LoadingFeedback';
const FileDetailPage = lazy(() => import('./pages/FileDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SavedArchivePage = lazy(() => import('./pages/SavedArchivePage'));
const LegacyPage = lazy(() => import('./pages/LegacyPage'));
import { ThemeProvider } from './components/ThemeProvider';
import { legacyReadingRoute } from './lib/fileProgress';

function RouteLoading() {
  const {t}=useTranslation();
  return <div className="approved-route-loading" role="status" aria-label={t('common.loading')}><BusyRing/></div>;
}

function LegacyReadingRedirect() {
  const location = useLocation();
  return <Navigate to={legacyReadingRoute(location.search)} replace />;
}

export default function App() {
  useEffect(() => {
    let active = true;
    const subscription = listen('dictionary-packs-changed', () => { if (active) window.dispatchEvent(new Event('lexicue-dictionary-changed')); });
    void subscription.catch(() => {});
    return () => { active = false; void subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, []);
  return (
    <ThemeProvider>
      <MobileStartup>
      <BrowserRouter useTransitions={false}>
        <Suspense fallback={<RouteLoading/>}><Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/files" replace/>} />
            <Route path="/example" element={<Navigate to="/files" replace />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/files/:fileId" element={<FileDetailPage />} />
            <Route path="/words" element={<Navigate to="/legacy?kind=words" replace />} />
            <Route path="/phrases" element={<Navigate to="/legacy?kind=phrases" replace />} />
            <Route path="/reading" element={<LegacyReadingRedirect />} />
            <Route path="/review" element={<Navigate to="/legacy?kind=reviews" replace />} />
            <Route path="/insights" element={<Navigate to="/legacy?kind=review_logs" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/saved" element={<SavedArchivePage />} />
            <Route path="/legacy" element={<LegacyPage />} />
          </Route>
        </Routes></Suspense>
      </BrowserRouter>
      </MobileStartup>
    </ThemeProvider>
  );
}
